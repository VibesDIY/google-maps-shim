// The slice of MapLibre GL the free map uses, as an injected port: index.ts
// hands in the real library, tests hand in a recording fake (no WebGL needed).

export type LngLatTuple = [number, number];

export interface MlLngLat {
  readonly lng: number;
  readonly lat: number;
}

export interface MlBounds {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

export interface MlMapEvent {
  readonly lngLat?: MlLngLat;
  readonly originalEvent?: Event;
}

export interface MlPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface MlMap {
  on(type: string, listener: (e: MlMapEvent) => void): unknown;
  getCenter(): MlLngLat;
  getZoom(): number;
  getBounds(): MlBounds;
  setCenter(center: LngLatTuple): unknown;
  setZoom(zoom: number): unknown;
  setMinZoom(zoom: number | null): unknown;
  setMaxZoom(zoom: number | null): unknown;
  jumpTo(opts: { center?: LngLatTuple; zoom?: number }): unknown;
  easeTo(opts: { center?: LngLatTuple; zoom?: number }): unknown;
  panTo(center: LngLatTuple): unknown;
  panBy(offset: LngLatTuple): unknown;
  fitBounds(bounds: [LngLatTuple, LngLatTuple], opts: { padding: number | MlPadding; maxZoom: number }): unknown;
  addControl(control: unknown, position?: "top-right" | "top-left" | "bottom-right" | "bottom-left"): unknown;
  remove(): void;
}

export interface MlMarker {
  setLngLat(lngLat: LngLatTuple): unknown;
  addTo(map: MlMap): unknown;
  remove(): unknown;
}

export interface MlPopup {
  setLngLat(lngLat: LngLatTuple): unknown;
  setHTML(html: string): unknown;
  setDOMContent(node: Node): unknown;
  addTo(map: MlMap): unknown;
  remove(): unknown;
  on(type: "close", listener: () => void): unknown;
}

export interface MlMapOptions {
  readonly container: HTMLElement;
  readonly style: string;
  readonly center: LngLatTuple;
  readonly zoom: number;
  readonly attributionControl: false;
  readonly cooperativeGestures: boolean;
  readonly interactive: boolean;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export interface MapLibrePort {
  createMap(opts: MlMapOptions): MlMap;
  createMarker(element: HTMLElement): MlMarker;
  createPopup(opts: { readonly maxWidth: string; readonly offset: number }): MlPopup;
  createNavigationControl(): unknown;
}

export interface DomPort {
  readonly document: Document;
  /** True when the page prefers a dark color scheme. */
  prefersDark(): boolean;
  /** Run `onGone` once when `element`, having been on the page, leaves it (see detach-watch.ts). */
  onDetached(element: HTMLElement, onGone: () => void): void;
}
