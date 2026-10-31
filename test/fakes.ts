import { Result } from "@adviser/cement";
import type { LngLatTuple, MapLibrePort, MlMap, MlMapEvent, MlMapOptions, MlMarker, MlPopup } from "../src/port.js";
import type { MapMode, PlacesQueryWire, PlacesResultWire } from "../src/places.js";
import { createGoogleMapsShim, type MapModeDecision, type RealLoaderModule } from "../src/loader.js";
import type { GoogleMapsApi } from "../src/google-bootstrap.js";

// Hand-built fakes injected through the shim's ports (rules-bag: inject at the
// caller boundary, never mock a module). Just enough DOM and MapLibre to record
// what the shim asked for.

export class FakeEvent {
  stopped = false;
  defaultPrevented = false;
  target: unknown = undefined;
  constructor(
    readonly type: string,
    readonly key?: string
  ) {}
  stopPropagation(): void {
    this.stopped = true;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

export class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  className = "";
  #text = "";

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.#text;
  }

  set textContent(v: string) {
    this.#text = v;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** Comma-separated tag names, plus `a[href]` and `[tabindex]`: what the shim asks. */
  querySelector(selector: string): FakeElement | null {
    const parts = selector.split(",").map((s) => s.trim());
    const matches = (e: FakeElement): boolean =>
      parts.some((p) =>
        p === "[tabindex]"
          ? e.attributes.has("tabindex")
          : p === "a[href]"
            ? e.tagName === "a" && e.attributes.has("href")
            : e.tagName === p
      );
    for (const child of this.children) {
      if (matches(child)) return child;
      const deeper = child.querySelector(selector);
      if (deeper !== null) return deeper;
    }
    return null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((f) => f !== fn)
    );
  }

  dispatch(type: string, key?: string): FakeEvent {
    const e = new FakeEvent(type, key);
    e.target = this;
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    return e;
  }
}

export class FakeDocument {
  readonly head = new FakeElement("head");

  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === "style[data-vibes-maplibre-css]") {
      return this.head.children.find((c) => c.attributes.has("data-vibes-maplibre-css")) ?? null;
    }
    return null;
  }
}

export class FakeMlMap implements MlMap {
  readonly calls: [string, ...unknown[]][] = [];
  readonly handlers = new Map<string, ((e: MlMapEvent) => void)[]>();
  center: { lng: number; lat: number };
  zoom: number;

  constructor(readonly opts: MlMapOptions) {
    this.center = { lng: opts.center[0], lat: opts.center[1] };
    this.zoom = opts.zoom;
  }

  on(type: string, listener: (e: MlMapEvent) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  fire(type: string, e: MlMapEvent = {}): void {
    for (const h of this.handlers.get(type) ?? []) h(e);
  }

  getCenter() {
    return this.center;
  }

  getZoom(): number {
    return this.zoom;
  }

  getBounds() {
    return { getWest: () => -122.7, getSouth: () => 45.5, getEast: () => -122.6, getNorth: () => 45.6 };
  }

  setCenter(c: LngLatTuple): void {
    this.calls.push(["setCenter", c]);
    this.center = { lng: c[0], lat: c[1] };
  }

  setZoom(z: number): void {
    this.calls.push(["setZoom", z]);
    this.zoom = z;
  }

  setMinZoom(z: number | null): void {
    this.calls.push(["setMinZoom", z]);
  }

  setMaxZoom(z: number | null): void {
    this.calls.push(["setMaxZoom", z]);
  }

  jumpTo(o: unknown): void {
    this.calls.push(["jumpTo", o]);
  }

  easeTo(o: unknown): void {
    this.calls.push(["easeTo", o]);
    this.fire("moveend"); // MapLibre stops the running move first
  }

  panTo(c: LngLatTuple): void {
    this.calls.push(["panTo", c]);
  }

  panBy(o: LngLatTuple): void {
    this.calls.push(["panBy", o]);
  }

  fitBounds(b: unknown, o: unknown): void {
    this.calls.push(["fitBounds", b, o]);
  }

  addControl(c: unknown, p?: string): void {
    this.calls.push(["addControl", c, p]);
  }

  remove(): void {
    this.calls.push(["remove"]);
  }
}

export class FakeMlMarker implements MlMarker {
  readonly calls: [string, ...unknown[]][] = [];
  constructor(readonly element: HTMLElement) {}
  setLngLat(l: LngLatTuple): void {
    this.calls.push(["setLngLat", l]);
  }
  addTo(m: MlMap): void {
    this.calls.push(["addTo", m]);
  }
  remove(): void {
    this.calls.push(["remove"]);
  }
}

export class FakeMlPopup implements MlPopup {
  readonly calls: [string, ...unknown[]][] = [];
  #onClose: (() => void)[] = [];
  constructor(readonly opts: { maxWidth: string; offset: number }) {}
  setLngLat(l: LngLatTuple): void {
    this.calls.push(["setLngLat", l]);
  }
  setHTML(h: string): void {
    this.calls.push(["setHTML", h]);
  }
  setDOMContent(n: Node): void {
    this.calls.push(["setDOMContent", n]);
  }
  addTo(m: MlMap): void {
    this.calls.push(["addTo", m]);
  }
  remove(): void {
    this.calls.push(["remove"]);
    this.#onClose.forEach((f) => f());
  }
  on(_type: "close", fn: () => void): void {
    this.#onClose.push(fn);
  }
  /** The person pressing the popup's own close button. */
  userClose(): void {
    this.#onClose.forEach((f) => f());
  }
}

export class FakeMapLibre implements MapLibrePort {
  readonly maps: FakeMlMap[] = [];
  readonly markers: FakeMlMarker[] = [];
  readonly popups: FakeMlPopup[] = [];
  createMap(opts: MlMapOptions): FakeMlMap {
    const m = new FakeMlMap(opts);
    this.maps.push(m);
    return m;
  }
  createMarker(el: HTMLElement): FakeMlMarker {
    const m = new FakeMlMarker(el);
    this.markers.push(m);
    return m;
  }
  createPopup(opts: { maxWidth: string; offset: number }): FakeMlPopup {
    const p = new FakeMlPopup(opts);
    this.popups.push(p);
    return p;
  }
  createNavigationControl(): { readonly nav: true } {
    return { nav: true };
  }
}

export interface Harness {
  readonly shim: ReturnType<typeof createGoogleMapsShim>;
  readonly ml: FakeMapLibre;
  readonly doc: FakeDocument;
  readonly global: Record<string, unknown>;
  readonly queries: PlacesQueryWire[];
  /** The page mode each search carried, in order. */
  readonly searchModes: MapMode[];
  readonly real: FakeRealLoader;
  /** Google's real Maps JavaScript API, as the fake bootstrap hands it over. */
  readonly google: FakeGoogleApi;
  /** How many times the shim asked the platform for the page's mode. */
  readonly modeCalls: () => number;
  /** How many constructed Google maps the shim reported. */
  readonly mapLoads: () => number;
  /** What the shim asked to hear about leaving the page; `detach(el)` plays the box being removed. */
  readonly detach: (element: HTMLElement) => void;
}

/** Google's real loader module, recording what the passthrough sent it. */
export class FakeRealLoader implements RealLoaderModule {
  loads = 0;
  readonly calls: [string, ...unknown[]][] = [];
  readonly Loader: RealLoaderModule["Loader"];

  constructor() {
    const calls = this.calls;
    this.Loader = class {
      constructor(readonly options: Record<string, unknown>) {
        calls.push(["new Loader", options]);
      }
      importLibrary(name: string): Promise<object> {
        calls.push(["Loader.importLibrary", name]);
        return Promise.resolve({ real: name });
      }
      load(): Promise<unknown> {
        calls.push(["Loader.load"]);
        return Promise.resolve({ maps: { real: true } });
      }
    };
  }

  setOptions(options: Record<string, unknown>): void {
    this.calls.push(["setOptions", options]);
  }

  importLibrary(name: string): Promise<object> {
    this.calls.push(["importLibrary", name]);
    return Promise.resolve({ real: name });
  }
}

/** Google's ControlPosition.BOTTOM_LEFT, as the fake script publishes it. */
export const FAKE_BOTTOM_LEFT = 10;

/** A stand-in for Google's own Map class: records what it was built with, and its controls. */
export class FakeGoogleMap {
  readonly controls: Record<string, unknown[]> = { [String(FAKE_BOTTOM_LEFT)]: [] };
  constructor(
    readonly el: unknown,
    readonly opts: Record<string, unknown>
  ) {}
}

/** Google's real libraries, loaded through the (fake) bootstrap. */
export class FakeGoogleApi implements GoogleMapsApi {
  readonly loads: Record<string, string>[] = [];
  readonly imported: string[] = [];
  importLibrary(name: string): Promise<object> {
    this.imported.push(name);
    // Google's libraries are frozen: their members are read-only.
    if (name === "maps") return Promise.resolve(Object.freeze({ Map: FakeGoogleMap, real: "maps" }));
    return Promise.resolve(Object.freeze({ real: name }));
  }
}

export function harness(
  opts: {
    dark?: boolean;
    answer?: Result<PlacesResultWire>;
    /** The platform's answer for the page; default free. */
    mode?: Result<MapModeDecision>;
    /** The bootstrap's script fails to load. */
    googleFails?: boolean;
  } = {}
): Harness {
  const ml = new FakeMapLibre();
  const doc = new FakeDocument();
  const global: Record<string, unknown> = {};
  const queries: PlacesQueryWire[] = [];
  const searchModes: MapMode[] = [];
  const real = new FakeRealLoader();
  const google = new FakeGoogleApi();
  let modeCalls = 0;
  let mapLoads = 0;
  const watched = new Map<HTMLElement, () => void>();
  const shim = createGoogleMapsShim({
    loadRealLoader: () => {
      real.loads += 1;
      return Promise.resolve(real);
    },
    maplibre: ml,
    css: ".maplibregl-map{position:relative}",
    document: doc as unknown as Document,
    prefersDark: () => opts.dark === true,
    onDetached: (element, onGone) => watched.set(element, onGone),
    mapsMode: () => {
      modeCalls += 1;
      return Promise.resolve(opts.mode ?? Result.Ok({ mode: "free", reason: "no-google-key" }));
    },
    reportMapLoad: () => {
      mapLoads += 1;
      return Promise.resolve(undefined);
    },
    loadGoogleMaps: (params) => {
      google.loads.push({ ...params });
      if (opts.googleFails === true) return Promise.reject(new Error("script failed"));
      // What Google's script leaves behind: google.maps with its own importLibrary.
      const g = (global.google ?? {}) as Record<string, unknown>;
      g.maps = {
        ...((g.maps as object | undefined) ?? {}),
        importLibrary: (n: string) => google.importLibrary(n),
        ControlPosition: { BOTTOM_LEFT: FAKE_BOTTOM_LEFT },
      };
      global.google = g;
      return Promise.resolve(google);
    },
    search: (q, mapMode) => {
      queries.push(q);
      searchModes.push(mapMode);
      return Promise.resolve(
        opts.answer ?? Result.Ok({ mode: "free", source: "overpass", attribution: "© OpenStreetMap contributors", places: [] })
      );
    },
    global,
  });
  const detach = (element: HTMLElement): void => {
    const onGone = watched.get(element);
    watched.delete(element);
    onGone?.();
  };
  return {
    shim,
    ml,
    doc,
    global,
    queries,
    searchModes,
    real,
    google,
    modeCalls: () => modeCalls,
    mapLoads: () => mapLoads,
    detach,
  };
}

export function el(tag = "div"): HTMLElement {
  return new FakeElement(tag) as unknown as HTMLElement;
}
