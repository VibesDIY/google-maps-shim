import { describe, expect, it } from "vitest";
import { Result } from "@adviser/cement";
import { el, FAKE_BOTTOM_LEFT, FakeDocument, FakeGoogleMap, harness } from "./fakes.js";
import { OSM_PLACES_CREDIT } from "../src/loader.js";
import { loadGoogleMapsApi } from "../src/google-bootstrap.js";
import type { PlacesResultWire } from "../src/places.js";

// Google mode (#8104 step 3): the platform decides the page's mode once, at the
// first importLibrary. Google pages get Google's real maps/marker/core (here a
// fake bootstrap) and OUR places, which always go through the platform search.

const GOOGLE_PAGE = Result.Ok({ mode: "google" as const, browserKey: "browser-key", mapId: "platform-map" });

const GOOGLE_ANSWER: PlacesResultWire = {
  mode: "google",
  source: "google",
  attribution: "Google",
  places: [
    {
      id: "ChIJblossom",
      displayName: "Blossoming Lotus",
      location: { lat: 45.5357, lng: -122.6503 },
      types: ["vegan_restaurant"],
      primaryType: "vegan_restaurant",
      rating: 4.6,
      userRatingCount: 1234,
      openNow: true,
      businessStatus: "OPERATIONAL",
      googleMapsURI: "https://maps.google.com/?cid=1",
      openingHoursText: ["Monday: 11:00 AM – 9:00 PM"],
    },
  ],
};

interface PlaceLike {
  readonly rating: number | null;
  readonly userRatingCount: number | null;
  readonly businessStatus: string | null;
  readonly googleMapsURI: string | null;
  readonly mapMode: string;
  readonly regularOpeningHours: { readonly weekdayDescriptions: readonly string[] } | null;
  isOpen(): Promise<boolean | undefined>;
}

interface PlaceStatic {
  searchNearby(req: Record<string, unknown>): Promise<{ places: PlaceLike[] }>;
  searchByText(req: Record<string, unknown>): Promise<{ places: PlaceLike[] }>;
}

const NEARBY = {
  fields: ["displayName", "location", "rating", "userRatingCount", "businessStatus", "googleMapsURI", "regularOpeningHours"],
  locationRestriction: { center: { lat: 45.52, lng: -122.68 }, radius: 8000 },
  includedPrimaryTypes: ["vegan_restaurant"],
};

describe("the page's mode", () => {
  it("is asked once per page, however many libraries load", async () => {
    const h = harness({ mode: GOOGLE_PAGE });
    await Promise.all([h.shim.importLibrary("maps"), h.shim.importLibrary("marker"), h.shim.importLibrary("places")]);
    await h.shim.importLibrary("core");
    expect(h.modeCalls()).toBe(1);
    expect(h.google.loads).toHaveLength(1);
  });

  it("falls back to the free map when the platform cannot answer", async () => {
    const h = harness({ mode: Result.Err("offline") });
    const maps = (await h.shim.importLibrary("maps")) as { Map: new (el: unknown, o: unknown) => unknown };
    expect(h.google.loads).toEqual([]);
    expect(maps.Map).not.toBe(FakeGoogleMap);
  });

  it("falls back to the free map when Google's script cannot load, before anything of Google's reached the app", async () => {
    const h = harness({ mode: GOOGLE_PAGE, googleFails: true });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await Place.searchNearby(NEARBY);
    expect(h.searchModes).toEqual(["free"]);
  });
});

describe("google mode", () => {
  it("loads Google's API with the platform's browser key and the app's own options, never the app's placeholder key", async () => {
    const h = harness({ mode: GOOGLE_PAGE });
    h.shim.setOptions({ key: "YOUR_API_KEY", v: "beta", language: "fr" });
    await h.shim.importLibrary("maps");
    expect(h.google.loads).toEqual([{ v: "beta", loading: "async", language: "fr", key: "browser-key" }]);
  });

  it("hands over Google's own maps and marker libraries, with the platform's Map ID on every map", async () => {
    const h = harness({ mode: GOOGLE_PAGE });
    const maps = (await h.shim.importLibrary("maps")) as {
      Map: new (el: unknown, o?: Record<string, unknown>) => FakeGoogleMap;
      real: string;
    };
    expect(maps.real).toBe("maps");
    const map = new maps.Map("box", { center: { lat: 1, lng: 2 }, zoom: 12, mapId: "someone-elses" });
    expect(map).toBeInstanceOf(FakeGoogleMap);
    expect(map.opts).toEqual({ colorScheme: "FOLLOW_SYSTEM", center: { lat: 1, lng: 2 }, zoom: 12, mapId: "platform-map" });
    expect(await h.shim.importLibrary("marker")).toEqual({ real: "marker" });
    // Google's whole API is there, not the free subset.
    expect(await h.shim.importLibrary("routes")).toEqual({ real: "routes" });
    expect(h.ml.maps).toHaveLength(0);
    expect((h.global.google as { maps: { Map: unknown } }).maps.Map).toBe(maps.Map);
  });

  it("serves places from the platform, never Google's browser library, on every door", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const lib = await h.shim.importLibrary("places");
    const ns = (h.global.google as { maps: { places: unknown; importLibrary(n: string): Promise<unknown> } }).maps;
    expect(ns.places).toBe(lib);
    expect(await ns.importLibrary("places")).toBe(lib);
    expect(h.google.imported).not.toContain("places");
  });

  it("returns Google places with their rating, open-now and status, and sends the Google-only filters", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    const { places } = await Place.searchNearby(NEARBY);
    expect(h.searchModes).toEqual(["google"]);
    expect(places[0]).toMatchObject({
      rating: 4.6,
      userRatingCount: 1234,
      businessStatus: "OPERATIONAL",
      googleMapsURI: "https://maps.google.com/?cid=1",
      mapMode: "google",
      regularOpeningHours: { weekdayDescriptions: ["Monday: 11:00 AM – 9:00 PM"] },
    });
    expect(await places[0].isOpen()).toBe(true);
    await Place.searchByText({
      textQuery: "vegan brunch",
      fields: ["displayName"],
      locationBias: { center: { lat: 45.52, lng: -122.68 }, radius: 5000 },
      isOpenNow: true,
      minRating: 4,
    });
    expect(h.queries[1]).toMatchObject({ search: "text", openNow: true, minRating: 4 });
  });

  it("searches around Google's own LatLng and LatLngBounds, as map.getCenter() and map.getBounds() return them", async () => {
    // Google's native objects are not the shim's classes: they answer through methods only.
    class NativeLatLng {
      readonly #lat: number;
      readonly #lng: number;
      constructor(lat: number, lng: number) {
        this.#lat = lat;
        this.#lng = lng;
      }
      lat(): number {
        return this.#lat;
      }
      lng(): number {
        return this.#lng;
      }
    }
    const nativeBounds = {
      getSouthWest: () => new NativeLatLng(45.5, -122.7),
      getNorthEast: () => new NativeLatLng(45.54, -122.66),
      getCenter: () => new NativeLatLng(45.52, -122.68),
    };
    const nativeCircle = { getCenter: () => new NativeLatLng(45.53, -122.65), getRadius: () => 1200 };
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await Place.searchNearby({ ...NEARBY, locationRestriction: nativeCircle });
    await Place.searchByText({
      textQuery: "vegan brunch",
      fields: ["displayName"],
      locationBias: new NativeLatLng(45.52, -122.68),
    });
    await Place.searchByText({ textQuery: "vegan brunch", fields: ["displayName"], locationRestriction: nativeBounds });
    expect(h.queries[0]).toMatchObject({ search: "nearby", center: { lat: 45.53, lng: -122.65 }, radius: 1200 });
    expect(h.queries[1]).toMatchObject({ search: "text", center: { lat: 45.52, lng: -122.68 } });
    expect(h.queries[2].center.lat).toBeCloseTo(45.52, 6);
    expect(h.queries[2].center.lng).toBeCloseTo(-122.68, 6);
    expect(h.queries[2].radius).toBeGreaterThan(2000);
  });

  it("shows OpenStreetMap places on a Google map when the platform answers free, with rating null and open-now unknown", async () => {
    const free: PlacesResultWire = {
      mode: "free",
      source: "overpass",
      attribution: "© OpenStreetMap contributors",
      reason: "out-of-credits",
      places: [
        { id: "osm:node/1", displayName: "Corner Vegan", location: { lat: 45.52, lng: -122.68 }, types: ["vegan_restaurant"] },
      ],
    };
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(free) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    const { places } = await Place.searchNearby(NEARBY);
    expect(places[0].rating).toBeNull();
    expect(places[0].mapMode).toBe("free");
    expect(await places[0].isOpen()).toBeUndefined();
  });
});

type MapCtor = new (el: unknown, o?: Record<string, unknown>) => FakeGoogleMap;

describe("map loads", () => {
  it("reports one load per constructed Google map, and none for deciding the page or importing places alone", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await Place.searchNearby(NEARBY);
    expect(h.mapLoads()).toBe(0);
    const { Map } = (await h.shim.importLibrary("maps")) as { Map: MapCtor };
    expect(h.mapLoads()).toBe(0);
    new Map("a");
    new Map("b");
    expect(h.mapLoads()).toBe(2);
  });

  it("reports nothing when Google's script fails to load", async () => {
    const h = harness({ mode: GOOGLE_PAGE, googleFails: true });
    const maps = (await h.shim.importLibrary("maps")) as { Map: new (el: unknown, o: unknown) => unknown };
    new maps.Map(el(), { center: { lat: 1, lng: 2 }, zoom: 3 });
    expect(h.mapLoads()).toBe(0);
  });

  it("v1 Loader.load() installs the Map-ID wrapper on google.maps.Map", async () => {
    const h = harness({ mode: GOOGLE_PAGE });
    const loader = new h.shim.Loader({ apiKey: "YOUR_API_KEY" });
    const google = (await loader.load()) as { maps: { Map: MapCtor } };
    const map = new google.maps.Map("box", { zoom: 4 });
    expect(map.opts).toMatchObject({ mapId: "platform-map", colorScheme: "FOLLOW_SYSTEM" });
    expect(h.mapLoads()).toBe(1);
  });
});

describe("OpenStreetMap places on a Google map", () => {
  const FREE_ANSWER: PlacesResultWire = {
    mode: "free",
    source: "overpass",
    attribution: "© OpenStreetMap contributors",
    reason: "google-quota",
    places: [
      { id: "osm:node/1", displayName: "Corner Vegan", location: { lat: 45.52, lng: -122.68 }, types: ["vegan_restaurant"] },
    ],
  };
  const credits = (map: FakeGoogleMap) =>
    (map.controls[String(FAKE_BOTTOM_LEFT)] as { textContent: string }[]).map((c) => c.textContent);

  it("puts the OpenStreetMap credit on every Google map, before and after, whatever fields were asked", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(FREE_ANSWER) });
    const { Map } = (await h.shim.importLibrary("maps")) as { Map: MapCtor };
    const before = new Map("a");
    expect(credits(before)).toEqual([]);
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await Place.searchNearby({ ...NEARBY, fields: ["displayName", "location"] });
    await Place.searchNearby({ ...NEARBY, fields: ["displayName", "location"] });
    const after = new Map("b");
    expect(credits(before)).toEqual([OSM_PLACES_CREDIT]);
    expect(credits(after)).toEqual([OSM_PLACES_CREDIT]);
  });

  it("adds no credit while Google answers", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const { Map } = (await h.shim.importLibrary("maps")) as { Map: MapCtor };
    const map = new Map("a");
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await Place.searchNearby(NEARBY);
    expect(credits(map)).toEqual([]);
  });
});

describe("the wire query on a Google page", () => {
  it("keeps primary types apart from plain ones", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await Place.searchNearby({ ...NEARBY, includedTypes: ["cafe"], excludedPrimaryTypes: ["bakery"] });
    expect(h.queries[0]).toMatchObject({
      includedPrimaryTypes: ["vegan_restaurant"],
      includedTypes: ["cafe"],
      excludedPrimaryTypes: ["bakery"],
    });
  });

  it("sends searchByText's locationRestriction as a box, and a bias as none", async () => {
    const h = harness({ mode: GOOGLE_PAGE, answer: Result.Ok(GOOGLE_ANSWER) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    const box = { south: 45.5, west: -122.7, north: 45.54, east: -122.66 };
    await Place.searchByText({ textQuery: "tacos", fields: ["displayName"], locationRestriction: box });
    await Place.searchByText({
      textQuery: "tacos",
      fields: ["displayName"],
      locationBias: { center: { lat: 45.52, lng: -122.68 }, radius: 1000 },
    });
    await Place.searchByText({
      textQuery: "tacos",
      fields: ["displayName"],
      locationRestriction: { center: { lat: 0, lng: 0 }, radius: 1113.2 },
    });
    expect(h.queries[0].restrictTo).toEqual(box);
    expect(h.queries[1].restrictTo).toBeUndefined();
    const around = h.queries[2].restrictTo;
    expect(around?.north).toBeCloseTo(0.01, 6);
    expect(around?.east).toBeCloseTo(0.01, 6);
  });
});

describe("free mode", () => {
  it("never shows a Google place on the free map", async () => {
    const h = harness({ answer: Result.Ok(GOOGLE_ANSWER) });
    const { Place } = (await h.shim.importLibrary("places")) as { Place: PlaceStatic };
    await expect(Place.searchNearby(NEARBY)).rejects.toThrow("Google places on a free map");
    expect(h.searchModes).toEqual(["free"]);
  });
});

describe("loadGoogleMapsApi", () => {
  it("adds Google's script with the key, the options in Google's spelling, and the bootstrap callback", async () => {
    const doc = new FakeDocument();
    const global: Record<string, unknown> = {};
    const loaded = loadGoogleMapsApi(
      { document: doc as unknown as Document, global },
      { key: "k", v: "weekly", authReferrerPolicy: "origin" }
    );
    const script = doc.head.children[0] as unknown as { src: string; async: boolean };
    expect(script.src).toContain("https://maps.googleapis.com/maps/api/js?");
    expect(script.src).toContain("key=k");
    expect(script.src).toContain("auth_referrer_policy=origin");
    expect(script.src).toContain("callback=google.maps.__ib__");
    expect(script.async).toBe(true);
    // What Google's script does when it runs: define importLibrary, then call back.
    const maps = (global.google as { maps: Record<string, unknown> }).maps;
    maps.importLibrary = (name: string) => Promise.resolve({ real: name });
    (maps.__ib__ as () => void)();
    const api = await loaded;
    expect(await api.importLibrary("maps")).toEqual({ real: "maps" });
  });

  it("rejects when the script cannot load", async () => {
    const doc = new FakeDocument();
    const loaded = loadGoogleMapsApi({ document: doc as unknown as Document, global: {} }, { key: "k" });
    (doc.head.children[0] as unknown as { onerror: () => void }).onerror();
    await expect(loaded).rejects.toThrow("could not load");
  });
});
