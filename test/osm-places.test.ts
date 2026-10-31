import { beforeEach, describe, expect, it } from "vitest";
import { URI } from "@adviser/cement";
import type { PlacesQueryWire as PlacesSearchQuery } from "../src/places.js";
import {
  attemptDeadlineMs,
  geoapifyElements,
  geoapifyUrls,
  overpassElements,
  overpassQuery,
  overpassRemarkError,
  placesQueryProblems,
  SEARCH_BUDGET_MS,
  resetFreePlacesCacheForTests,
  roundedSearchArea,
  searchPlacesFree,
  toPlaceWire,
  typesFromText,
  upstreamAsk,
  type PlacesFetch,
} from "../src/osm-places.js";

// Free-mode place search (#8104): OSM answers from Geoapify or Overpass,
// reshaped into Google Places (New) fields. Fetch is injected, never mocked.

const PORTLAND = { lat: 45.5231, lng: -122.6765 };

function recordingFetch(answer: (url: string, init?: RequestInit) => Response): {
  readonly fetch: PlacesFetch;
  readonly calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(answer(url, init));
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const GEOAPIFY_BODY = {
  type: "FeatureCollection",
  features: [
    {
      properties: {
        name: "Blossoming Lotus",
        lat: 45.5245,
        lon: -122.6766,
        formatted: "Blossoming Lotus, 1713 NE 15th Ave, Portland, OR 97212, United States",
        place_id: "51abc",
        datasource: {
          sourcename: "openstreetmap",
          raw: {
            osm_id: 123,
            osm_type: "n",
            name: "Blossoming Lotus",
            amenity: "restaurant",
            "diet:vegan": "only",
            website: "blossominglotus.com",
            opening_hours: "Mo-Fr 11:00-21:00; Sa-Su 10:00-21:00",
            "addr:housenumber": "1713",
            "addr:street": "NE 15th Ave",
            "addr:city": "Portland",
            "addr:state": "OR",
            "addr:postcode": "97212",
            phone: "+1 503 555 0100",
          },
        },
      },
    },
    {
      // Far outside the asked-for circle: dropped by the per-request distance filter.
      properties: {
        name: "Far Cafe",
        lat: 45.7,
        lon: -122.9,
        place_id: "far",
        datasource: { raw: { osm_id: 9, osm_type: "w", amenity: "cafe" } },
      },
    },
    {
      // No name: Google never lists an unnamed place, so neither do we.
      properties: {
        lat: 45.523,
        lon: -122.676,
        place_id: "anon",
        datasource: { raw: { osm_id: 10, osm_type: "n", amenity: "cafe" } },
      },
    },
  ],
};

const OVERPASS_BODY = {
  elements: [
    { type: "node", id: 42, lat: 45.524, lon: -122.677, tags: { name: "Off-Leash Area", leisure: "dog_park" } },
    { type: "way", id: 77, center: { lat: 45.53, lon: -122.68 }, tags: { name: "Laurelhurst Park", leisure: "park" } },
  ],
};

beforeEach(() => {
  resetFreePlacesCacheForTests();
});

describe("query shaping", () => {
  it("rounds the point so nearby viewers share an answer, and widens the circle by the rounding slack", () => {
    expect(roundedSearchArea({ center: PORTLAND, radius: 4000 })).toEqual({ lat: 45.52, lng: -122.68, radius: 5800 });
    expect(roundedSearchArea({ center: { lat: 45.5249, lng: -122.6751 }, radius: 4500 })).toEqual(
      roundedSearchArea({ center: PORTLAND, radius: 4000 })
    );
  });

  it("reads Google types out of a text query, longest phrase first", () => {
    expect(typesFromText("dog parks near me")).toEqual(["dog_park"]);
    // A diet word qualifies; it is not a second kind of place.
    expect(typesFromText("vegan bakery in Portland")).toEqual(["bakery"]);
    expect(upstreamAsk({ search: "text", center: PORTLAND, radius: 1000, textQuery: "Powell's" })).toEqual({
      types: [],
      diets: [],
      name: "Powell's",
    });
  });

  it('"vegan restaurants" is restaurants that are vegan, an intersection (#8113 review)', () => {
    const ask = upstreamAsk({ search: "text", center: PORTLAND, radius: 5000, textQuery: "vegan restaurants near me" });
    expect(ask).toEqual({ types: ["restaurant"], diets: ["vegan"] });
    expect(overpassQuery({ area: { lat: 45.52, lng: -122.68, radius: 5800 }, ask })).toBe(
      '[out:json][timeout:10];(nwr["amenity"~"^(restaurant)$"]["diet:vegan"~"^(only|yes)$"](around:5800,45.52,-122.68););out body center 200;'
    );
    const [url] = geoapifyUrls({ area: { lat: 45.52, lng: -122.68, radius: 5800 }, ask, apiKey: "k" });
    expect(URI.from(url).getParam("categories")).toBe("catering.restaurant");
    expect(URI.from(url).getParam("conditions")).toBe("vegan");
    // "vegan" alone still means places serving vegan food.
    expect(upstreamAsk({ search: "text", center: PORTLAND, radius: 5000, textQuery: "vegan" }).types).toEqual(["vegan_restaurant"]);
  });

  it("a name with an includedType is that place, not every place of the type (#8113 review)", () => {
    const ask = upstreamAsk({
      search: "text",
      center: PORTLAND,
      radius: 5000,
      textQuery: "Blossoming Lotus",
      includedTypes: ["restaurant"],
    });
    expect(ask).toEqual({ types: ["restaurant"], diets: [], name: "Blossoming Lotus" });
    expect(overpassQuery({ area: { lat: 45.52, lng: -122.68, radius: 5800 }, ask })).toBe(
      '[out:json][timeout:10];(nwr["amenity"~"^(restaurant)$"]["name"~"Blossoming Lotus",i](around:5800,45.52,-122.68););out body center 200;'
    );
    const [url] = geoapifyUrls({ area: { lat: 45.52, lng: -122.68, radius: 5800 }, ask, apiKey: "k" });
    expect(URI.from(url).getParam("name")).toBe("Blossoming Lotus");
  });

  it("keeps a name written beside a kind of place, and drops a lower-case wish or a city (#8113 review)", () => {
    const at = { search: "text" as const, center: PORTLAND, radius: 5000 };
    expect(upstreamAsk({ ...at, textQuery: "Powell's", includedTypes: ["book_store"] })).toEqual({
      types: ["book_store"],
      diets: [],
      name: "Powell's",
    });
    expect(upstreamAsk({ ...at, textQuery: "Powell's Books" })).toEqual({ types: ["book_store"], diets: [], name: "Powell's" });
    expect(upstreamAsk({ ...at, textQuery: "cheap coffee" })).toEqual({ types: ["coffee_shop"], diets: [] });
    expect(upstreamAsk({ ...at, textQuery: "coffee in Portland" })).toEqual({ types: ["coffee_shop"], diets: [] });
    expect(upstreamAsk({ ...at, textQuery: "Blossoming Lotus in Portland" })).toEqual({
      types: [],
      diets: [],
      name: "Blossoming Lotus",
    });
  });

  it("refuses inherited keys as place types rather than throwing (#8113 review)", () => {
    for (const t of ["constructor", "toString", "__proto__"]) {
      expect(placesQueryProblems({ search: "nearby", center: PORTLAND, radius: 1000, includedTypes: [t] }).join("\n")).toContain(
        `place type "${t}" is not available in the free map`
      );
    }
  });

  it("names unknown types and missing inputs in words", () => {
    const problems = placesQueryProblems({
      search: "nearby",
      center: PORTLAND,
      radius: 99999,
      includedTypes: ["casino"],
      maxResultCount: 0,
    });
    expect(problems.join("\n")).toContain("radius must be between 1 and 50000 meters");
    expect(problems.join("\n")).toContain("maxResultCount must be a whole number from 1 to 20");
    expect(problems.join("\n")).toContain('place type "casino" is not available in the free map');
    expect(placesQueryProblems({ search: "nearby", center: PORTLAND, radius: 1000 })).toEqual([
      "searchNearby in the free map needs includedPrimaryTypes or includedTypes naming what to find",
    ]);
  });

  it("builds an Overpass union from the type table", () => {
    const q = overpassQuery({
      area: { lat: 45.52, lng: -122.68, radius: 5800 },
      ask: { types: ["vegan_restaurant", "park"], diets: [] },
    });
    expect(q).toBe(
      '[out:json][timeout:10];(nwr["amenity"~"^(restaurant|cafe|fast_food)$"]["diet:vegan"~"^(only|yes)$"](around:5800,45.52,-122.68);' +
        'nwr["leisure"~"^(park)$"](around:5800,45.52,-122.68););out body center 200;'
    );
  });

  it("splits Geoapify requests by conditions, since a condition applies to every category in a request", () => {
    const urls = geoapifyUrls({
      area: { lat: 45.52, lng: -122.68, radius: 5800 },
      ask: { types: ["vegan_restaurant", "park", "cafe"], diets: [] },
      apiKey: "k",
    });
    expect(urls).toHaveLength(2);
    const vegan = URI.from(urls[0]);
    expect(`${vegan.protocol}//${vegan.hostname}${vegan.pathname}`).toBe("https://api.geoapify.com/v2/places");
    expect(vegan.getParam("categories")).toBe("catering.restaurant,catering.cafe,catering.fast_food");
    expect(vegan.getParam("conditions")).toBe("vegan");
    expect(vegan.getParam("filter")).toBe("circle:-122.68,45.52,5800");
    const plain = URI.from(urls[1]);
    expect(plain.getParam("categories")).toBe("leisure.park,catering.cafe");
    expect(plain.getParam("conditions")).toBeUndefined();
  });
});

describe("OSM → Google-shaped place", () => {
  it("maps a Geoapify feature with its OSM identity, address, hours and types", () => {
    const [el] = geoapifyElements(GEOAPIFY_BODY);
    expect(el.id).toBe("osm:node/123");
    expect(toPlaceWire(el, PORTLAND)).toEqual({
      id: "osm:node/123",
      displayName: "Blossoming Lotus",
      location: { lat: 45.5245, lng: -122.6766 },
      types: ["vegan_restaurant", "restaurant"],
      primaryType: "vegan_restaurant",
      formattedAddress: "1713 NE 15th Ave, Portland, OR 97212",
      websiteURI: "https://blossominglotus.com",
      nationalPhoneNumber: "+1 503 555 0100",
      openingHoursText: ["Mo-Fr 11:00-21:00", "Sa-Su 10:00-21:00"],
      servesVegetarianFood: true,
      distanceMeters: 156,
    });
  });

  it("maps Overpass nodes and ways (ways by their center)", () => {
    const els = overpassElements(OVERPASS_BODY);
    expect(els.map((e) => e.id)).toEqual(["osm:node/42", "osm:way/77"]);
    expect(toPlaceWire(els[1], PORTLAND)?.location).toEqual({ lat: 45.53, lng: -122.68 });
    expect(toPlaceWire(els[0], PORTLAND)?.types).toEqual(["dog_park"]);
  });
});

describe("searchPlacesFree", () => {
  it("asks Geoapify when the platform holds GEOAPIFY_KEY, filters to the circle, nearest first", async () => {
    const f = recordingFetch(() => json(GEOAPIFY_BODY));
    const query: PlacesSearchQuery = { search: "nearby", center: PORTLAND, radius: 2000, includedTypes: ["vegan_restaurant"] };
    const r = await searchPlacesFree({ fetch: f.fetch, query, geoapifyKey: "geo-key" });
    expect(r.isOk()).toBe(true);
    const result = r.Ok();
    expect(result.mode).toBe("free");
    expect(result.source).toBe("geoapify");
    expect(result.attribution).toBe("© OpenStreetMap contributors");
    expect(result.places.map((p) => p.id)).toEqual(["osm:node/123"]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toContain("apiKey=geo-key");
  });

  it("falls to Overpass with no Geoapify key, trying the next mirror when one is busy", async () => {
    const f = recordingFetch((url) => (url.includes("overpass-api.de") ? json({ error: "busy" }, 504) : json(OVERPASS_BODY)));
    const r = await searchPlacesFree({
      fetch: f.fetch,
      query: { search: "nearby", center: PORTLAND, radius: 5000, includedTypes: ["dog_park", "park"] },
      geoapifyKey: "",
    });
    expect(r.Ok().source).toBe("overpass");
    expect(r.Ok().places.map((p) => p.displayName)).toEqual(["Off-Leash Area", "Laurelhurst Park"]);
    expect(f.calls.map((c) => URI.from(c.url).hostname)).toEqual(["overpass-api.de", "overpass.private.coffee"]);
    expect(f.calls[0].init?.method).toBe("POST");
  });

  it("keeps node coordinates: most shops and restaurants are nodes, not ways (#8113 review)", () => {
    const els = overpassElements({
      elements: [
        { type: "node", id: 7, lat: 45.5, lon: -122.6, tags: { name: "Corner Cafe", amenity: "cafe" } },
        { type: "way", id: 8, center: { lat: 45.51, lon: -122.61 }, tags: { name: "Big Park", leisure: "park" } },
      ],
    });
    expect(els.map((e) => [e.id, e.lat, e.lng])).toEqual([
      ["osm:node/7", 45.5, -122.6],
      ["osm:way/8", 45.51, -122.61],
    ]);
  });

  it("treats a 200 with an Overpass runtime-error remark as a failure: next mirror, nothing cached (#8113 review)", async () => {
    expect(overpassRemarkError({ remark: 'runtime error: Query timed out in "query" at line 1 after 11 seconds.' })).toContain(
      "timed out"
    );
    expect(overpassRemarkError(OVERPASS_BODY)).toBeUndefined();
    const timedOut = { elements: [], remark: "runtime error: Query run out of memory using about 2048 MB of RAM." };
    const f = recordingFetch((url) => json(url.includes("overpass-api.de") ? timedOut : OVERPASS_BODY));
    const query: PlacesSearchQuery = { search: "nearby", center: PORTLAND, radius: 5000, includedTypes: ["park"] };
    const r = await searchPlacesFree({ fetch: f.fetch, query });
    expect(r.Ok().places.length).toBeGreaterThan(0);
    expect(f.calls.map((c) => URI.from(c.url).hostname)).toEqual(["overpass-api.de", "overpass.private.coffee"]);

    resetFreePlacesCacheForTests();
    const allBusy = recordingFetch(() => json(timedOut));
    const rBusy = await searchPlacesFree({ fetch: allBusy.fetch, query });
    expect(rBusy.Err().message).toContain("out of memory");
    await searchPlacesFree({ fetch: allBusy.fetch, query });
    expect(allBusy.calls).toHaveLength(4);
  });

  it("finishes inside the app's 30s idle window: each call is cut to what is left of the budget (#8113 review)", () => {
    expect(SEARCH_BUDGET_MS).toBeLessThan(30_000);
    const deadline = 1_000_000;
    expect(attemptDeadlineMs({ deadline, now: deadline - SEARCH_BUDGET_MS })).toBe(12_000);
    expect(attemptDeadlineMs({ deadline, now: deadline - 5_000 })).toBe(5_000);
    expect(attemptDeadlineMs({ deadline, now: deadline + 1 })).toBe(0);
  });

  it("serves a second viewer in the same rounded area from the shared answer", async () => {
    const f = recordingFetch(() => json(OVERPASS_BODY));
    const query: PlacesSearchQuery = { search: "nearby", center: PORTLAND, radius: 5000, includedTypes: ["park"] };
    await searchPlacesFree({ fetch: f.fetch, query });
    await searchPlacesFree({ fetch: f.fetch, query: { ...query, center: { lat: 45.5212, lng: -122.6788 } } });
    expect(f.calls).toHaveLength(1);
  });

  it("keeps no failed answer: every mirror failing is an Err, and the next search asks again", async () => {
    const f = recordingFetch(() => json({}, 503));
    const query: PlacesSearchQuery = { search: "nearby", center: PORTLAND, radius: 5000, includedTypes: ["park"] };
    const r = await searchPlacesFree({ fetch: f.fetch, query });
    expect(r.isErr()).toBe(true);
    expect(r.Err().message).toContain("every Overpass mirror failed");
    await searchPlacesFree({ fetch: f.fetch, query });
    expect(f.calls).toHaveLength(4);
  });

  it("keeps the text's meaning whatever the source answers: only the named place, only vegan ones", async () => {
    const mixed = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 45.5235,
          lon: -122.677,
          tags: { name: "Blossoming Lotus", amenity: "restaurant", "diet:vegan": "only" },
        },
        { type: "node", id: 2, lat: 45.524, lon: -122.678, tags: { name: "Steak Barn", amenity: "restaurant" } },
      ],
    };
    const f = recordingFetch(() => json(mixed));
    const named = await searchPlacesFree({
      fetch: f.fetch,
      query: { search: "text", center: PORTLAND, radius: 5000, textQuery: "Blossoming Lotus", includedTypes: ["restaurant"] },
    });
    expect(named.Ok().places.map((p) => p.displayName)).toEqual(["Blossoming Lotus"]);
    const vegan = await searchPlacesFree({
      fetch: f.fetch,
      query: { search: "text", center: PORTLAND, radius: 5000, textQuery: "vegan restaurants" },
    });
    expect(vegan.Ok().places.map((p) => p.displayName)).toEqual(["Blossoming Lotus"]);
  });

  it("refuses an invalid query before any upstream call", async () => {
    const f = recordingFetch(() => json(OVERPASS_BODY));
    const r = await searchPlacesFree({ fetch: f.fetch, query: { search: "text", center: PORTLAND, radius: 1000, textQuery: " " } });
    expect(r.Err().message).toContain("searchByText needs a textQuery");
    expect(f.calls).toHaveLength(0);
  });
});
