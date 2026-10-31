import { describe, expect, it } from "vitest";
import { FakeElement, el, harness } from "./fakes.js";
import { LatLng, LatLngBounds, event } from "../src/core.js";
import { FREE_MAP_ATTRIBUTION, OPENFREEMAP_DARK, OPENFREEMAP_LIGHT } from "../src/free-map.js";

interface MapsLib {
  Map: new (
    div: HTMLElement | null,
    opts?: Record<string, unknown>
  ) => {
    getCenter(): LatLng;
    getZoom(): number;
    getBounds(): LatLngBounds;
    setZoom(z: number): void;
    panTo(p: unknown): void;
    fitBounds(b: unknown, padding?: unknown): void;
    addListener(name: string, fn: (e: unknown) => void): { remove(): void };
    getDiv(): HTMLElement;
  };
  InfoWindow: new (opts?: Record<string, unknown>) => {
    open(o: unknown, anchor?: unknown): void;
    close(): void;
    setContent(c: unknown): void;
    addListener(name: string, fn: () => void): { remove(): void };
    isOpen(): boolean;
  };
  Marker: new (opts?: Record<string, unknown>) => { getPosition(): LatLng | null; addListener(n: string, f: () => void): unknown };
}

interface MarkerLib {
  AdvancedMarkerElement: new (opts?: Record<string, unknown>) => {
    element: HTMLElement;
    map: unknown;
    position: LatLng | null;
    title: string;
    addListener(name: string, fn: (e: unknown) => void): { remove(): void };
    addEventListener(name: string, fn: (e: unknown) => void): void;
    removeEventListener(name: string, fn: (e: unknown) => void): void;
  };
  PinElement: new (opts?: Record<string, unknown>) => { element: HTMLElement };
}

async function libs(opts: { dark?: boolean } = {}) {
  const h = harness(opts);
  const maps = (await h.shim.importLibrary("maps")) as unknown as MapsLib;
  const marker = (await h.shim.importLibrary("marker")) as unknown as MarkerLib;
  return { h, maps, marker };
}

describe("loader surface", () => {
  it("importLibrary serves maps, marker, places and core, and publishes google.maps", async () => {
    const { h, maps } = await libs();
    const google = h.global.google as { maps: Record<string, unknown> };
    expect(google.maps.Map).toBe(maps.Map);
    expect(typeof google.maps.LatLng).toBe("function");
    expect((google.maps.marker as Record<string, unknown>).AdvancedMarkerElement).toBeDefined();
    expect(await h.shim.importLibrary("core")).toHaveProperty("LatLngBounds");
    expect(await h.shim.importLibrary("places")).toHaveProperty("Place");
  });

  it("a library outside the subset rejects, naming it", async () => {
    const { h } = await libs();
    await expect(h.shim.importLibrary("geometry")).rejects.toThrow('importLibrary("geometry") is not available in the free map');
    await expect(h.shim.importLibrary("routes")).rejects.toThrow("not available in the free map");
  });

  it("a google.maps class outside the subset throws by name when read", async () => {
    const { h, maps } = await libs();
    const google = h.global.google as { maps: Record<string, unknown> };
    expect(() => google.maps.DirectionsService).toThrow("google.maps.DirectionsService is not available in the free map");
    expect(() => (maps as unknown as Record<string, unknown>).Polyline).toThrow("maps.Polyline is not available in the free map");
    const places = (await h.shim.importLibrary("places")) as Record<string, unknown>;
    expect(() => places.Autocomplete).toThrow("places.Autocomplete is not available in the free map");
  });

  it("the v1 Loader class ignores the key and loads the same libraries", async () => {
    const h = harness();
    const loader = new h.shim.Loader({ apiKey: "AIza-ignored", version: "weekly", libraries: ["marker"] });
    const maps = (await loader.importLibrary("maps")) as unknown as MapsLib;
    expect(typeof maps.Map).toBe("function");
    const google = (await loader.load()) as { maps: Record<string, unknown> };
    expect(google.maps.Map).toBe(maps.Map);
    h.shim.setOptions({ key: "AIza-ignored", v: "weekly" });
  });
});

describe("Map", () => {
  it("draws MapLibre on OpenFreeMap positron, with the center, zoom, attribution and stylesheet", async () => {
    const { h, maps } = await libs();
    const div = new FakeElement("div");
    const map = new maps.Map(div as unknown as HTMLElement, { center: { lat: 45.52, lng: -122.68 }, zoom: 13, mapId: "DEMO" });
    const ml = h.ml.maps[0];
    expect(ml.opts.style).toBe(OPENFREEMAP_LIGHT);
    expect(ml.opts.center).toEqual([-122.68, 45.52]);
    expect(ml.opts.zoom).toBe(13);
    expect(ml.opts.attributionControl).toBe(false);
    expect(div.children.map((c) => c.textContent)).toContain(FREE_MAP_ATTRIBUTION);
    expect(h.doc.head.children).toHaveLength(1);
    new maps.Map(el(), { center: { lat: 1, lng: 2 }, zoom: 3 });
    expect(h.doc.head.children).toHaveLength(1);
    expect(map.getCenter().lat()).toBe(45.52);
    expect(map.getZoom()).toBe(13);
  });

  it("uses the dark style when the page prefers dark", async () => {
    const { h, maps } = await libs({ dark: true });
    new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    expect(h.ml.maps[0].opts.style).toBe(OPENFREEMAP_DARK);
  });

  it("refuses a null container with a sentence about it", async () => {
    const { maps } = await libs();
    expect(() => new maps.Map(null, {})).toThrow("needs its container element");
  });

  it("forwards fitBounds, panTo, setZoom and getBounds to MapLibre", async () => {
    const { h, maps } = await libs();
    const map = new maps.Map(el(), { center: { lat: 45.5, lng: -122.6 }, zoom: 12 });
    const ml = h.ml.maps[0];
    const bounds = new LatLngBounds();
    bounds.extend({ lat: 45.5, lng: -122.7 }).extend(new LatLng(45.6, -122.6));
    map.fitBounds(bounds, 48);
    map.panTo({ lat: 1, lng: 2 });
    map.setZoom(15);
    expect(ml.calls).toContainEqual([
      "fitBounds",
      [
        [-122.7, 45.5],
        [-122.6, 45.6],
      ],
      { padding: 48, maxZoom: 17 },
    ]);
    expect(ml.calls).toContainEqual(["panTo", [2, 1]]);
    expect(ml.calls).toContainEqual(["easeTo", { center: [2, 1], zoom: 15 }]);
    expect(map.getBounds().toJSON()).toEqual({ north: 45.6, south: 45.5, east: -122.6, west: -122.7 });
  });

  it("panTo then setZoom lands on the panned-to place: the zoom eases there instead of cancelling the pan (#8113 QA)", async () => {
    const { h, maps } = await libs();
    const map = new maps.Map(el(), { center: { lat: 45.5, lng: -122.6 }, zoom: 12 });
    const ml = h.ml.maps[0];
    map.panTo({ lat: 45.52, lng: -122.68 });
    map.setZoom(15);
    expect(ml.calls.slice(-2)).toEqual([
      ["panTo", [-122.68, 45.52]],
      ["easeTo", { center: [-122.68, 45.52], zoom: 15 }],
    ]);
    // A second setZoom while that move runs still heads for the same place.
    map.setZoom(16);
    expect(ml.calls.at(-1)).toEqual(["easeTo", { center: [-122.68, 45.52], zoom: 16 }]);
    // Once the move has ended, a zoom is a zoom.
    ml.fire("moveend");
    map.setZoom(14);
    expect(ml.calls.at(-1)).toEqual(["setZoom", 14]);
    // setCenter is a jump, so nothing is left heading anywhere.
    map.panTo({ lat: 1, lng: 1 });
    (map as unknown as { setCenter(c: unknown): void }).setCenter({ lat: 2, lng: 2 });
    map.setZoom(13);
    expect(ml.calls.at(-1)).toEqual(["setZoom", 13]);
  });

  it("forwards a click with a LatLng, and refuses events it would never fire", async () => {
    const { h, maps } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const seen: unknown[] = [];
    const listener = map.addListener("click", (e) => seen.push(e));
    h.ml.maps[0].fire("click", { lngLat: { lng: 10, lat: 20 } });
    expect((seen[0] as { latLng: LatLng }).latLng.toJSON()).toEqual({ lat: 20, lng: 10 });
    listener.remove();
    h.ml.maps[0].fire("click", { lngLat: { lng: 10, lat: 20 } });
    expect(seen).toHaveLength(1);
    expect(() => map.addListener("heading_changed", () => undefined)).toThrow(
      'Map event "heading_changed" is not available in the free map'
    );
  });

  it("a Map method outside the subset throws by name", async () => {
    const { maps } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 }) as unknown as Record<string, unknown>;
    expect(() => map.setTilt).toThrow("Map.setTilt is not available in the free map");
    expect(() => map.getStreetView).toThrow("Map.getStreetView is not available in the free map");
  });
});

describe("markers and InfoWindow", () => {
  it("AdvancedMarkerElement pins its content at its position and fires click and gmp-click", async () => {
    const { h, maps, marker } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const content = el();
    const m = new marker.AdvancedMarkerElement({ map, position: { lat: 45.5, lng: -122.6 }, content, title: "Blossoming Lotus" });
    const ml = h.ml.markers[0];
    expect(ml.calls[0]).toEqual(["setLngLat", [-122.6, 45.5]]);
    expect(ml.calls[1]).toEqual(["addTo", h.ml.maps[0]]);
    expect((m.element as unknown as FakeElement).children[0]).toBe(content);
    expect(m.element.getAttribute("title")).toBe("Blossoming Lotus");
    const clicks: string[] = [];
    m.addListener("click", () => clicks.push("click"));
    m.addEventListener("gmp-click", () => clicks.push("gmp-click"));
    const domEvent = (m.element as unknown as FakeElement).dispatch("click");
    expect(clicks).toEqual(["click", "gmp-click"]);
    expect(domEvent.stopped).toBe(true);
    m.map = null;
    expect(ml.calls.at(-1)).toEqual(["remove"]);
  });

  it("a marker moved straight from one map to another leaves the first", async () => {
    const { h, maps, marker } = await libs();
    const mapA = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const mapB = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const m = new marker.AdvancedMarkerElement({ map: mapA, position: { lat: 1, lng: 1 } });
    m.map = mapB;
    expect(h.ml.markers).toHaveLength(2);
    expect(h.ml.markers[0].calls.at(-1)).toEqual(["remove"]);
    expect(h.ml.markers[1].calls).toContainEqual(["addTo", h.ml.maps[1]]);
    m.map = mapB;
    expect(h.ml.markers).toHaveLength(2);

    const classic = new maps.Marker({ map: mapA, position: { lat: 2, lng: 2 } }) as unknown as { setMap(map: unknown): void };
    classic.setMap(mapB);
    expect(h.ml.markers[2].calls.at(-1)).toEqual(["remove"]);
    expect(h.ml.markers[3].calls).toContainEqual(["addTo", h.ml.maps[1]]);
  });

  it("removeEventListener takes off what addEventListener put on, for gmp-click and click too (#8113 review)", async () => {
    const { maps, marker } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const m = new marker.AdvancedMarkerElement({ map, position: { lat: 1, lng: 1 } });
    const clicks: string[] = [];
    const onGmp = (): number => clicks.push("gmp-click");
    const onClick = (): number => clicks.push("click");
    m.addEventListener("gmp-click", onGmp);
    m.addEventListener("click", onClick);
    const wrapper = m.element as unknown as FakeElement;
    wrapper.dispatch("click");
    expect(clicks).toEqual(["click", "gmp-click"]);
    m.removeEventListener("gmp-click", onGmp);
    m.removeEventListener("click", onClick);
    wrapper.dispatch("click");
    expect(clicks).toEqual(["click", "gmp-click"]);
  });

  it("a clickable marker is a keyboard button; an app's own <button> content keeps the job (#8113 review)", async () => {
    const { maps, marker } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const plain = new marker.AdvancedMarkerElement({ map, position: { lat: 1, lng: 1 } });
    const plainEl = plain.element as unknown as FakeElement;
    expect(plainEl.getAttribute("role")).toBeNull();
    expect(plainEl.getAttribute("tabindex")).toBeNull();
    const picks: string[] = [];
    plain.addListener("gmp-click", () => picks.push("plain"));
    expect(plainEl.getAttribute("role")).toBe("button");
    expect(plainEl.getAttribute("tabindex")).toBe("0");
    const enter = plainEl.dispatch("keydown", "Enter");
    plainEl.dispatch("keydown", " ");
    plainEl.dispatch("keydown", "a");
    expect(picks).toEqual(["plain", "plain"]);
    expect(enter.defaultPrevented).toBe(true);

    const flagged = new marker.AdvancedMarkerElement({ map, position: { lat: 1, lng: 1 }, gmpClickable: true });
    expect(flagged.element.getAttribute("tabindex")).toBe("0");

    const button = el("button");
    const own = new marker.AdvancedMarkerElement({ map, position: { lat: 1, lng: 1 }, content: button });
    own.addListener("click", () => picks.push("own"));
    const ownEl = own.element as unknown as FakeElement;
    expect(ownEl.getAttribute("role")).toBeNull();
    expect(ownEl.getAttribute("tabindex")).toBeNull();
    ownEl.dispatch("keydown", "Enter"); // the button's own Enter becomes a click, which reaches the wrapper
    expect(picks).toEqual(["plain", "plain"]);
    ownEl.dispatch("click");
    expect(picks).toEqual(["plain", "plain", "own"]);
  });

  it("the map lets go of MapLibre when its box leaves the page, since Google's Map has no destroy (#8113 review)", async () => {
    const { h, maps } = await libs();
    const box = el();
    new maps.Map(box, { center: { lat: 0, lng: 0 }, zoom: 2 });
    expect(h.ml.maps[0].calls).not.toContainEqual(["remove"]);
    h.detach(box);
    expect(h.ml.maps[0].calls.at(-1)).toEqual(["remove"]);
  });

  it("a marker with no content gets Google's default pin", async () => {
    const { maps, marker } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const m = new marker.AdvancedMarkerElement({ map, position: { lat: 1, lng: 1 } });
    expect((m.element as unknown as FakeElement).children[0].className).toBe("vibes-free-map-pin");
    const pin = new marker.PinElement({ glyph: "3", background: "#123" });
    expect((pin.element as unknown as FakeElement).children[0].textContent).toBe("3");
  });

  it("InfoWindow opens over its marker anchor, closes, and reports the person's close as closeclick", async () => {
    const { h, maps, marker } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const m = new marker.AdvancedMarkerElement({ map, position: { lat: 45.5, lng: -122.6 } });
    const info = new maps.InfoWindow({ content: "<b>Hi</b>" });
    const events: string[] = [];
    info.addListener("closeclick", () => events.push("closeclick"));
    info.open({ map, anchor: m });
    const popup = h.ml.popups[0];
    expect(popup.calls).toContainEqual(["setHTML", "<b>Hi</b>"]);
    expect(popup.calls).toContainEqual(["setLngLat", [-122.6, 45.5]]);
    expect(popup.calls).toContainEqual(["addTo", h.ml.maps[0]]);
    expect(info.isOpen()).toBe(true);
    info.close();
    expect(info.isOpen()).toBe(false);
    expect(events).toEqual([]);
    info.open(map, m);
    h.ml.popups[1].userClose();
    expect(events).toEqual(["closeclick"]);
  });

  it("InfoWindow without a map or anchor says what it needs", async () => {
    const { maps } = await libs();
    const info = new maps.InfoWindow({ content: "x" });
    expect(() => info.open({})).toThrow("InfoWindow.open needs a map");
  });

  it("the classic Marker works for apps that still write it", async () => {
    const { h, maps } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    const m = new maps.Marker({ map, position: { lat: 3, lng: 4 }, label: "A" });
    expect(m.getPosition()?.toJSON()).toEqual({ lat: 3, lng: 4 });
    expect(h.ml.markers).toHaveLength(1);
  });
});

describe("core values and events", () => {
  it("LatLngBounds grows by extend and reports its center", () => {
    const b = new LatLngBounds();
    expect(b.isEmpty()).toBe(true);
    b.extend({ lat: 10, lng: 20 });
    b.extend({ lat: 20, lng: 40 });
    expect(b.getCenter().toJSON()).toEqual({ lat: 15, lng: 30 });
    expect(b.contains({ lat: 12, lng: 25 })).toBe(true);
    expect(() => new LatLngBounds().getCenter()).toThrow("empty bounds");
  });

  it("LatLng refuses a non-number instead of drawing at NaN", () => {
    expect(() => new LatLng(Number.NaN, 1)).toThrow("finite");
    expect(new LatLng({ lat: 1, lng: 2 }).toUrlValue()).toBe("1,2");
  });

  it("event.addListener / removeListener / trigger work on shim objects", async () => {
    const { maps } = await libs();
    const map = new maps.Map(el(), { center: { lat: 0, lng: 0 }, zoom: 2 });
    let n = 0;
    const l = event.addListener(map, "idle", () => (n += 1));
    event.trigger(map, "idle");
    event.removeListener(l);
    event.trigger(map, "idle");
    expect(n).toBe(1);
    expect(() => event.addDomListener()).toThrow("not available in the free map");
  });
});
