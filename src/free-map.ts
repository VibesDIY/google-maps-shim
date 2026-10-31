import {
  Evented,
  LatLng,
  LatLngBounds,
  event,
  toLatLng,
  toLatLngBounds,
  type LatLngBoundsLiteral,
  type LatLngLike,
  type MapsEventListener,
  type Handler,
} from "./core.js";
import { defineUnavailable, notInFreeMap } from "./errors.js";
import type { DomPort, LngLatTuple, MapLibrePort, MlMap, MlMapEvent, MlMarker, MlPopup } from "./port.js";

// The free map: google.maps.Map, markers and InfoWindow drawn by MapLibre GL on
// OpenFreeMap vector tiles. Same constructors, options and methods an app
// writes for Google's map, for the subset in FREE_MAP_SUBSET; everything else
// throws by name.

export const FREE_MAP_ATTRIBUTION = "© OpenFreeMap · © OpenStreetMap contributors";
export const OPENFREEMAP_LIGHT = "https://tiles.openfreemap.org/styles/positron";
export const OPENFREEMAP_DARK = "https://tiles.openfreemap.org/styles/dark";
/** A single pin fitted by fitBounds would otherwise zoom to street level 22. */
const FIT_MAX_ZOOM = 17;

export interface FreeMapDeps extends DomPort {
  readonly maplibre: MapLibrePort;
  /** MapLibre's stylesheet, injected once per document. */
  readonly css: string;
}

export interface MapOptions {
  readonly center?: LatLngLike;
  readonly zoom?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /** Accepted and ignored: the free map has one look, light or dark with the page. */
  readonly mapId?: string;
  readonly disableDefaultUI?: boolean;
  readonly zoomControl?: boolean;
  readonly gestureHandling?: "cooperative" | "greedy" | "none" | "auto";
  readonly [option: string]: unknown;
}

export type Padding = number | { top?: number; right?: number; bottom?: number; left?: number };

interface MarkerLike {
  readonly anchorPosition: LatLng | null;
  readonly anchorMap: unknown;
}

const MAP_EVENTS: Readonly<Record<string, string>> = {
  click: "click",
  dblclick: "dblclick",
  rightclick: "contextmenu",
  contextmenu: "contextmenu",
  mousemove: "mousemove",
  idle: "idle",
  tilesloaded: "idle",
  bounds_changed: "move",
  center_changed: "move",
  zoom_changed: "zoom",
  drag: "drag",
  dragstart: "dragstart",
  dragend: "dragend",
};

const UNAVAILABLE_MAP_METHODS = [
  "setTilt",
  "getTilt",
  "setHeading",
  "getHeading",
  "setMapTypeId",
  "getMapTypeId",
  "getStreetView",
  "setStreetView",
  "getProjection",
  "data",
  "controls",
  "overlayMapTypes",
  "mapTypes",
];

function lngLat(p: LatLng): LngLatTuple {
  return [p.lng(), p.lat()];
}

export function createFreeMap(deps: FreeMapDeps) {
  const mlOf = new WeakMap<object, MlMap>();
  let cssInjected = false;

  function ensureCss(): void {
    if (cssInjected) return;
    cssInjected = true;
    const doc = deps.document;
    if (doc.querySelector("style[data-vibes-maplibre-css]") !== null) return;
    const style = doc.createElement("style");
    style.setAttribute("data-vibes-maplibre-css", "");
    style.textContent = deps.css;
    doc.head.appendChild(style);
  }

  function mlMapFor(map: unknown, who: string): MlMap {
    const ml = typeof map === "object" && map !== null ? mlOf.get(map) : undefined;
    if (ml === undefined) throw new Error(`${who}: map must be a google.maps.Map from importLibrary("maps")`);
    return ml;
  }

  function toPadding(padding: Padding | undefined): number | { top: number; right: number; bottom: number; left: number } {
    if (padding === undefined) return 0;
    if (typeof padding === "number") return padding;
    return { top: padding.top ?? 0, right: padding.right ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0 };
  }

  class FreeMap extends Evented {
    protected readonly eventNames = Object.keys(MAP_EVENTS);
    protected readonly className = "Map";
    readonly #div: HTMLElement;
    readonly #ml: MlMap;
    /**
     * Where an animated move (panTo, fitBounds) is headed until it ends.
     * MapLibre's setZoom jumps and cancels a running animation, so Google's
     * `panTo(p); setZoom(15)` would stop short of p; setZoom eases to both.
     */
    #headingTo: LngLatTuple | undefined;

    constructor(div: HTMLElement | null, opts: MapOptions = {}) {
      super();
      if (div === null || div === undefined) {
        throw new Error("google.maps.Map needs its container element (got null): render the map's box before creating the Map");
      }
      ensureCss();
      this.#div = div;
      const center = opts.center === undefined ? undefined : toLatLng(opts.center);
      this.#ml = deps.maplibre.createMap({
        container: div,
        style: deps.prefersDark() ? OPENFREEMAP_DARK : OPENFREEMAP_LIGHT,
        center: center === undefined ? [0, 0] : lngLat(center),
        zoom: opts.zoom ?? (center === undefined ? 1 : 12),
        attributionControl: false,
        cooperativeGestures: opts.gestureHandling === "cooperative",
        interactive: opts.gestureHandling !== "none",
        ...(opts.minZoom === undefined ? {} : { minZoom: opts.minZoom }),
        ...(opts.maxZoom === undefined ? {} : { maxZoom: opts.maxZoom }),
      });
      mlOf.set(this, this.#ml);
      this.#ml.on("moveend", () => {
        this.#headingTo = undefined;
      });
      if (opts.disableDefaultUI !== true && opts.zoomControl !== false) {
        this.#ml.addControl(deps.maplibre.createNavigationControl(), "top-right");
      }
      const credit = deps.document.createElement("div");
      credit.className = "vibes-free-map-attribution";
      credit.setAttribute(
        "style",
        "position:absolute;right:4px;bottom:2px;z-index:2;padding:0 4px;font:11px/1.5 system-ui,sans-serif;background:rgba(255,255,255,.75);color:#333;border-radius:3px;pointer-events:auto"
      );
      credit.textContent = FREE_MAP_ATTRIBUTION;
      div.appendChild(credit);
      // Google's Map has no destroy, so apps never call one: the box leaving
      // the page is the end of the map, and MapLibre's WebGL context and
      // workers go with it.
      deps.onDetached(div, () => this.#ml.remove());
    }

    protected override startForwarding(name: string): void {
      const mlName = MAP_EVENTS[name];
      this.#ml.on(mlName, (e: MlMapEvent) => {
        if (name === "click" || name === "dblclick" || name === "rightclick" || name === "contextmenu" || name === "mousemove") {
          const latLng = e.lngLat === undefined ? null : new LatLng(e.lngLat.lat, e.lngLat.lng);
          this.emit(name, { latLng, domEvent: e.originalEvent, stop: () => undefined });
          return;
        }
        this.emit(name);
      });
    }

    getDiv(): HTMLElement {
      return this.#div;
    }

    getCenter(): LatLng {
      const c = this.#ml.getCenter();
      return new LatLng(c.lat, c.lng);
    }

    setCenter(center: LatLngLike): void {
      this.#headingTo = undefined;
      this.#ml.setCenter(lngLat(toLatLng(center)));
    }

    getZoom(): number {
      return this.#ml.getZoom();
    }

    setZoom(zoom: number): void {
      const center = this.#headingTo;
      if (center === undefined) {
        this.#ml.setZoom(zoom);
        return;
      }
      this.#ml.easeTo({ center, zoom });
      // easeTo stops the old move first, and its moveend clears the target; this move still heads there.
      this.#headingTo = center;
    }

    getBounds(): LatLngBounds {
      const b = this.#ml.getBounds();
      return new LatLngBounds({ lat: b.getSouth(), lng: b.getWest() }, { lat: b.getNorth(), lng: b.getEast() });
    }

    panTo(center: LatLngLike): void {
      const target = lngLat(toLatLng(center));
      this.#ml.panTo(target);
      this.#headingTo = target;
    }

    panBy(x: number, y: number): void {
      this.#ml.panBy([x, y]);
    }

    moveCamera(camera: { center?: LatLngLike; zoom?: number; heading?: number; tilt?: number }): void {
      if (camera.heading !== undefined) throw notInFreeMap("Map.moveCamera heading");
      if (camera.tilt !== undefined) throw notInFreeMap("Map.moveCamera tilt");
      if (camera.center !== undefined) this.#headingTo = undefined;
      this.#ml.jumpTo({
        ...(camera.center === undefined ? {} : { center: lngLat(toLatLng(camera.center)) }),
        ...(camera.zoom === undefined ? {} : { zoom: camera.zoom }),
      });
    }

    fitBounds(bounds: LatLngBounds | LatLngBoundsLiteral, padding?: Padding): void {
      const b = toLatLngBounds(bounds);
      if (b.isEmpty()) return;
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      this.#ml.fitBounds([lngLat(sw), lngLat(ne)], { padding: toPadding(padding), maxZoom: FIT_MAX_ZOOM });
      this.#headingTo = lngLat(b.getCenter());
    }

    panToBounds(bounds: LatLngBounds | LatLngBoundsLiteral, padding?: Padding): void {
      this.fitBounds(bounds, padding);
    }

    setOptions(opts: MapOptions): void {
      if (opts.center !== undefined) this.setCenter(opts.center);
      if (opts.zoom !== undefined) this.setZoom(opts.zoom);
      if (opts.minZoom !== undefined) this.#ml.setMinZoom(opts.minZoom);
      if (opts.maxZoom !== undefined) this.#ml.setMaxZoom(opts.maxZoom);
    }
  }
  defineUnavailable(FreeMap.prototype, UNAVAILABLE_MAP_METHODS, "Map.");

  // ── Markers ────────────────────────────────────────────────────────────

  interface PinOptions {
    readonly background?: string;
    readonly borderColor?: string;
    readonly glyphColor?: string;
    readonly glyph?: string | HTMLElement | null;
    readonly glyphText?: string;
    readonly scale?: number;
  }

  /** google.maps.marker.PinElement: Google's teardrop pin, as an element to hand a marker. */
  class PinElement {
    readonly element: HTMLElement;

    constructor(opts: PinOptions = {}) {
      const doc = deps.document;
      const size = Math.round(26 * (opts.scale ?? 1));
      const pin = doc.createElement("div");
      pin.className = "vibes-free-map-pin";
      pin.setAttribute(
        "style",
        `width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
          `background:${opts.background ?? "#EA4335"};border:2px solid ${opts.borderColor ?? "#B31412"};` +
          `display:grid;place-items:center;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.35)`
      );
      const glyph = doc.createElement("div");
      glyph.setAttribute(
        "style",
        `transform:rotate(45deg);color:${opts.glyphColor ?? "#fff"};font:600 ${Math.round(size * 0.45)}px/1 system-ui,sans-serif`
      );
      const content = opts.glyphText ?? opts.glyph;
      if (typeof content === "string") glyph.textContent = content;
      else if (content !== undefined && content !== null) glyph.appendChild(content);
      pin.appendChild(glyph);
      this.element = pin;
    }
  }

  const INTERACTIVE = "button,a[href],input,select,textarea,[tabindex]";

  /** Content that already takes focus and Enter/Space itself (an app's own `<button>`), so the wrapper must not. */
  function isInteractive(content: HTMLElement): boolean {
    if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(content.tagName.toUpperCase())) return true;
    if (content.getAttribute("tabindex") !== null) return true;
    return content.querySelector(INTERACTIVE) !== null;
  }

  /** A DOM element pinned to a map position; shared by AdvancedMarkerElement and the legacy Marker. */
  class PinOnMap {
    readonly wrapper: HTMLElement;
    map: FreeMap | null = null;
    position: LatLng | null = null;
    #ml: MlMarker | undefined;
    /** The map the MapLibre marker is on now, so a move to another map takes it off this one. */
    #attachedTo: FreeMap | null = null;
    #clickable = false;
    #content: HTMLElement | undefined;

    constructor(onClick: (domEvent: Event) => void) {
      this.wrapper = deps.document.createElement("div");
      this.wrapper.className = "vibes-free-map-marker";
      this.wrapper.addEventListener("click", (domEvent: Event) => {
        // Google never fires the map's click for a marker click.
        domEvent.stopPropagation();
        onClick(domEvent);
      });
      // A clickable marker is a button to the keyboard too. Only when the
      // wrapper itself is the button: an app's own <button> content already
      // turns Enter/Space into the click that reaches the handler above.
      this.wrapper.addEventListener("keydown", (domEvent: Event) => {
        const key = (domEvent as KeyboardEvent).key;
        if (!this.#wrapperIsButton() || domEvent.target !== this.wrapper) return;
        if (key !== "Enter" && key !== " ") return;
        domEvent.preventDefault();
        domEvent.stopPropagation();
        onClick(domEvent);
      });
    }

    setContent(content: HTMLElement): void {
      this.wrapper.textContent = "";
      this.wrapper.appendChild(content);
      this.#content = content;
      this.#applyClickable();
    }

    /** Clicks have a listener (or gmpClickable is set): pointer cursor, and focus plus button semantics when the content lacks its own. */
    makeClickable(): void {
      if (this.#clickable) return;
      this.#clickable = true;
      this.#applyClickable();
    }

    #wrapperIsButton(): boolean {
      return this.#clickable && this.#content !== undefined && !isInteractive(this.#content);
    }

    #applyClickable(): void {
      if (!this.#clickable) return;
      this.wrapper.style.cursor = "pointer";
      if (this.#wrapperIsButton()) {
        this.wrapper.setAttribute("role", "button");
        this.wrapper.setAttribute("tabindex", "0");
      } else {
        this.wrapper.removeAttribute("role");
        this.wrapper.removeAttribute("tabindex");
      }
    }

    sync(): void {
      if (this.#ml !== undefined && (this.map === null || this.position === null || this.map !== this.#attachedTo)) {
        this.#ml.remove();
        this.#ml = undefined;
        this.#attachedTo = null;
      }
      if (this.map === null || this.position === null) return;
      if (this.#ml === undefined) {
        this.#ml = deps.maplibre.createMarker(this.wrapper);
        this.#ml.setLngLat(lngLat(this.position));
        this.#ml.addTo(mlMapFor(this.map, "marker"));
        this.#attachedTo = this.map;
        return;
      }
      this.#ml.setLngLat(lngLat(this.position));
    }
  }

  function asMap(map: unknown, who: string): FreeMap | null {
    if (map === null || map === undefined) return null;
    if (!(map instanceof FreeMap)) throw new Error(`${who}: map must be a google.maps.Map from importLibrary("maps")`);
    return map;
  }

  interface AdvancedMarkerOptions {
    readonly map?: FreeMap | null;
    readonly position?: LatLngLike | null;
    readonly content?: HTMLElement | null;
    readonly title?: string;
    readonly gmpClickable?: boolean;
    readonly zIndex?: number | null;
    readonly gmpDraggable?: boolean;
    readonly collisionBehavior?: string;
  }

  /** google.maps.marker.AdvancedMarkerElement */
  class AdvancedMarkerElement extends Evented implements MarkerLike {
    protected readonly eventNames = ["click", "gmp-click"];
    protected readonly className = "AdvancedMarkerElement";
    readonly #pin: PinOnMap;
    #content: HTMLElement;
    #title = "";
    #zIndex: number | null = null;

    constructor(opts: AdvancedMarkerOptions = {}) {
      super();
      if (opts.gmpDraggable === true) throw notInFreeMap("AdvancedMarkerElement gmpDraggable");
      this.#pin = new PinOnMap((domEvent) => {
        const payload = { domEvent, latLng: this.#pin.position, target: this, stop: () => undefined };
        this.emit("click", payload);
        this.emit("gmp-click", payload);
      });
      this.#content = opts.content ?? new PinElement().element;
      this.#pin.setContent(this.#content);
      if (opts.title !== undefined) this.title = opts.title;
      if (opts.zIndex !== undefined) this.zIndex = opts.zIndex;
      if (opts.gmpClickable === true) this.#pin.makeClickable();
      this.#pin.position = opts.position === undefined || opts.position === null ? null : toLatLng(opts.position);
      this.#pin.map = asMap(opts.map, "AdvancedMarkerElement");
      this.#pin.sync();
    }

    /** The marker's own element (Google's marker IS an element). */
    get element(): HTMLElement {
      return this.#pin.wrapper;
    }

    get anchorPosition(): LatLng | null {
      return this.#pin.position;
    }

    get anchorMap(): unknown {
      return this.#pin.map;
    }

    get map(): FreeMap | null {
      return this.#pin.map;
    }

    set map(map: FreeMap | null) {
      this.#pin.map = asMap(map, "AdvancedMarkerElement.map");
      this.#pin.sync();
    }

    get position(): LatLng | null {
      return this.#pin.position;
    }

    set position(position: LatLngLike | null) {
      this.#pin.position = position === null || position === undefined ? null : toLatLng(position);
      this.#pin.sync();
    }

    get content(): HTMLElement {
      return this.#content;
    }

    set content(content: HTMLElement | null) {
      this.#content = content ?? new PinElement().element;
      this.#pin.setContent(this.#content);
    }

    get title(): string {
      return this.#title;
    }

    set title(title: string) {
      this.#title = title;
      this.#pin.wrapper.setAttribute("title", title);
      this.#pin.wrapper.setAttribute("aria-label", title);
    }

    get zIndex(): number | null {
      return this.#zIndex;
    }

    set zIndex(z: number | null) {
      this.#zIndex = z;
      this.#pin.wrapper.style.zIndex = z === null ? "" : String(z);
    }

    /** Google: a click listener makes the marker clickable. */
    override addListener(name: string, handler: Handler): MapsEventListener {
      const listener = super.addListener(name, handler);
      this.#pin.makeClickable();
      return listener;
    }

    /** The registrations `addEventListener` made for the marker's own events, so the matching remove finds them. */
    readonly #ownEventListeners = new Map<string, Map<(e: unknown) => void, MapsEventListener>>();

    /** `gmp-click`/`click` are the marker's own; any other name is a DOM event on its element. */
    addEventListener(name: string, handler: (e: unknown) => void): void {
      if (name === "gmp-click" || name === "click") {
        const byHandler = this.#ownEventListeners.get(name) ?? new Map<(e: unknown) => void, MapsEventListener>();
        if (byHandler.has(handler)) return; // the DOM's rule: the same listener twice is one listener
        byHandler.set(handler, this.addListener(name, handler as Handler));
        this.#ownEventListeners.set(name, byHandler);
        return;
      }
      this.#pin.wrapper.addEventListener(name, handler as EventListener);
    }

    removeEventListener(name: string, handler: (e: unknown) => void): void {
      if (name === "gmp-click" || name === "click") {
        const byHandler = this.#ownEventListeners.get(name);
        byHandler?.get(handler)?.remove();
        byHandler?.delete(handler);
        return;
      }
      this.#pin.wrapper.removeEventListener(name, handler as EventListener);
    }
  }

  interface LegacyMarkerOptions {
    readonly map?: FreeMap | null;
    readonly position?: LatLngLike | null;
    readonly title?: string;
    readonly label?: string | { text: string; color?: string } | null;
    readonly icon?: string | { url: string } | null;
    readonly visible?: boolean;
    readonly draggable?: boolean;
    readonly clickable?: boolean;
  }

  /** google.maps.Marker (the classic marker, still what many apps write). */
  class Marker extends Evented implements MarkerLike {
    protected readonly eventNames = ["click"];
    protected readonly className = "Marker";
    readonly #pin: PinOnMap;
    #title = "";
    #label: string | null = null;
    #icon: string | null = null;
    #visible = true;
    #wantedMap: FreeMap | null = null;

    constructor(opts: LegacyMarkerOptions = {}) {
      super();
      if (opts.draggable === true) throw notInFreeMap("Marker draggable");
      this.#pin = new PinOnMap((domEvent) => this.emit("click", { domEvent, latLng: this.#pin.position, stop: () => undefined }));
      if (opts.clickable === true) this.#pin.makeClickable();
      this.#title = opts.title ?? "";
      this.#label = typeof opts.label === "string" ? opts.label : (opts.label?.text ?? null);
      this.#icon = typeof opts.icon === "string" ? opts.icon : (opts.icon?.url ?? null);
      this.#visible = opts.visible ?? true;
      this.#pin.position = opts.position === undefined || opts.position === null ? null : toLatLng(opts.position);
      this.#wantedMap = asMap(opts.map, "Marker");
      this.#render();
    }

    /** Google: a click listener makes the marker clickable. */
    override addListener(name: string, handler: Handler): MapsEventListener {
      const listener = super.addListener(name, handler);
      this.#pin.makeClickable();
      return listener;
    }

    #render(): void {
      if (this.#icon !== null) {
        const img = deps.document.createElement("img");
        img.setAttribute("src", this.#icon);
        img.setAttribute("alt", this.#title);
        this.#pin.setContent(img);
      } else {
        this.#pin.setContent(new PinElement({ glyph: this.#label }).element);
      }
      this.#pin.wrapper.setAttribute("title", this.#title);
      this.#pin.map = this.#visible ? this.#wantedMap : null;
      this.#pin.sync();
    }

    get anchorPosition(): LatLng | null {
      return this.#pin.position;
    }

    get anchorMap(): unknown {
      return this.#wantedMap;
    }

    setMap(map: FreeMap | null): void {
      this.#wantedMap = asMap(map, "Marker.setMap");
      this.#render();
    }

    getMap(): FreeMap | null {
      return this.#wantedMap;
    }

    setPosition(position: LatLngLike | null): void {
      this.#pin.position = position === null ? null : toLatLng(position);
      this.#pin.sync();
    }

    getPosition(): LatLng | null {
      return this.#pin.position;
    }

    setTitle(title: string): void {
      this.#title = title;
      this.#render();
    }

    getTitle(): string {
      return this.#title;
    }

    setLabel(label: string | { text: string } | null): void {
      this.#label = typeof label === "string" ? label : (label?.text ?? null);
      this.#render();
    }

    setIcon(icon: string | { url: string } | null): void {
      this.#icon = typeof icon === "string" ? icon : (icon?.url ?? null);
      this.#render();
    }

    setVisible(visible: boolean): void {
      this.#visible = visible;
      this.#render();
    }

    getVisible(): boolean {
      return this.#visible;
    }
  }
  defineUnavailable(Marker.prototype, ["setAnimation", "setDraggable", "setShape", "setCursor"], "Marker.");

  // ── InfoWindow ─────────────────────────────────────────────────────────

  interface InfoWindowOptions {
    readonly content?: string | Node | null;
    readonly position?: LatLngLike | null;
    readonly maxWidth?: number;
    readonly headerContent?: string | Node | null;
    readonly ariaLabel?: string;
    readonly [option: string]: unknown;
  }

  function isMarkerLike(v: unknown): v is MarkerLike {
    return v instanceof AdvancedMarkerElement || v instanceof Marker;
  }

  /** google.maps.InfoWindow, as a MapLibre popup. */
  class InfoWindow extends Evented {
    protected readonly eventNames = ["closeclick", "close", "domready", "content_changed"];
    protected readonly className = "InfoWindow";
    #content: string | Node | null;
    #position: LatLng | null;
    readonly #maxWidth: number;
    #popup: MlPopup | undefined;
    #map: FreeMap | null = null;
    #closing = false;

    constructor(opts: InfoWindowOptions = {}) {
      super();
      this.#content = opts.content ?? null;
      this.#position = opts.position === undefined || opts.position === null ? null : toLatLng(opts.position);
      this.#maxWidth = opts.maxWidth ?? 280;
    }

    setContent(content: string | Node | null): void {
      this.#content = content;
      if (this.#popup !== undefined) this.#fill(this.#popup);
      this.emit("content_changed");
    }

    getContent(): string | Node | null {
      return this.#content;
    }

    setPosition(position: LatLngLike | null): void {
      this.#position = position === null ? null : toLatLng(position);
      if (this.#popup !== undefined && this.#position !== null) this.#popup.setLngLat(lngLat(this.#position));
    }

    getPosition(): LatLng | null {
      return this.#position;
    }

    getMap(): FreeMap | null {
      return this.#map;
    }

    isOpen(): boolean {
      return this.#popup !== undefined;
    }

    #fill(popup: MlPopup): void {
      const c = this.#content;
      if (c === null) popup.setHTML("");
      else if (typeof c === "string") popup.setHTML(c);
      else popup.setDOMContent(c);
    }

    /** `open({ map, anchor })`, or the older `open(map, anchor)`. */
    open(
      optsOrMap?: { map?: FreeMap | null; anchor?: unknown; shouldFocus?: boolean } | FreeMap | null,
      anchorArg?: unknown
    ): void {
      const opts =
        optsOrMap instanceof FreeMap || optsOrMap === null || optsOrMap === undefined
          ? { map: optsOrMap, anchor: anchorArg }
          : optsOrMap;
      const anchor = opts.anchor;
      if (anchor !== undefined && anchor !== null && !isMarkerLike(anchor)) {
        throw notInFreeMap("InfoWindow anchor other than a marker");
      }
      const map = asMap(opts.map ?? (anchor === undefined || anchor === null ? null : anchor.anchorMap), "InfoWindow.open");
      if (map === null) throw new Error("InfoWindow.open needs a map, or a marker anchor that is on a map");
      const position = anchor === undefined || anchor === null ? this.#position : anchor.anchorPosition;
      if (position === null) throw new Error("InfoWindow.open needs a position, or a marker anchor with a position");
      this.#position = position;
      this.#removePopup();
      const popup = deps.maplibre.createPopup({
        maxWidth: `${this.#maxWidth}px`,
        offset: anchor === undefined || anchor === null ? 0 : 30,
      });
      this.#fill(popup);
      popup.setLngLat(lngLat(position));
      popup.on("close", () => {
        if (this.#popup !== popup) return;
        this.#popup = undefined;
        this.#map = null;
        if (!this.#closing) this.emit("closeclick");
        this.emit("close");
      });
      popup.addTo(mlMapFor(map, "InfoWindow.open"));
      this.#popup = popup;
      this.#map = map;
      this.emit("domready");
    }

    #removePopup(): void {
      const popup = this.#popup;
      if (popup === undefined) return;
      this.#closing = true;
      popup.remove();
      this.#closing = false;
      this.#popup = undefined;
    }

    close(): void {
      this.#removePopup();
      this.#map = null;
    }
  }

  return { Map: FreeMap, Marker, AdvancedMarkerElement, PinElement, InfoWindow, event, LatLng, LatLngBounds };
}

export type FreeMapLibrary = ReturnType<typeof createFreeMap>;
export type { MapsEventListener };
