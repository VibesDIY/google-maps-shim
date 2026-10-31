import { describe, expect, it } from "vitest";
import { Result } from "@adviser/cement";
import { harness } from "./fakes.js";
import { LatLng } from "../src/core.js";
import type { PlacesResultWire } from "../src/places.js";

interface PlaceLike {
  id: string;
  displayName?: string | null;
  location?: LatLng | null;
  formattedAddress?: string | null;
  websiteURI?: string | null;
  rating?: number | null;
  regularOpeningHours?: { weekdayDescriptions: string[] } | null;
  types?: string[];
  primaryType?: string | null;
  fetchFields(o: { fields: string[] }): Promise<{ place: PlaceLike }>;
  isOpen(): Promise<boolean | undefined>;
  toJSON(): Record<string, unknown>;
}

interface PlaceStatic {
  searchNearby(req: Record<string, unknown>): Promise<{ places: PlaceLike[] }>;
  searchByText(req: Record<string, unknown>): Promise<{ places: PlaceLike[] }>;
}

const ANSWER: PlacesResultWire = {
  mode: "free",
  source: "geoapify",
  attribution: "© OpenStreetMap contributors",
  places: [
    {
      id: "osm:node/123",
      displayName: "Blossoming Lotus",
      location: { lat: 45.5231, lng: -122.6765 },
      types: ["vegan_restaurant", "restaurant"],
      primaryType: "vegan_restaurant",
      formattedAddress: "1713 NE 15th Ave, Portland, OR 97212",
      websiteURI: "https://blossominglotus.com",
      openingHoursText: ["Mo-Fr 11:00-21:00", "Sa-Su 10:00-21:00"],
      servesVegetarianFood: true,
      distanceMeters: 420,
    },
  ],
};

async function placeLib(answer: Result<PlacesResultWire> = Result.Ok(ANSWER)) {
  const h = harness({ answer });
  const { Place } = (await h.shim.importLibrary("places")) as unknown as { Place: PlaceStatic };
  return { h, Place };
}

describe("Place.searchNearby", () => {
  it("sends one platform query and hands back Google-shaped places with the requested fields", async () => {
    const { h, Place } = await placeLib();
    const { places } = await Place.searchNearby({
      fields: ["displayName", "location", "formattedAddress", "rating", "regularOpeningHours"],
      locationRestriction: { center: { lat: 45.52, lng: -122.68 }, radius: 5000 },
      includedPrimaryTypes: ["vegan_restaurant"],
      includedTypes: ["cafe"],
      maxResultCount: 20,
    });
    expect(h.queries).toEqual([
      {
        search: "nearby",
        center: { lat: 45.52, lng: -122.68 },
        radius: 5000,
        includedTypes: ["cafe"],
        includedPrimaryTypes: ["vegan_restaurant"],
        maxResultCount: 20,
      },
    ]);
    const [p] = places;
    expect(p.id).toBe("osm:node/123");
    expect(p.displayName).toBe("Blossoming Lotus");
    expect(p.location).toBeInstanceOf(LatLng);
    expect(p.location?.lat()).toBe(45.5231);
    expect(p.formattedAddress).toBe("1713 NE 15th Ave, Portland, OR 97212");
    expect(p.regularOpeningHours?.weekdayDescriptions).toEqual(["Mo-Fr 11:00-21:00", "Sa-Su 10:00-21:00"]);
    // Asked for but not in OpenStreetMap: null, the way Google answers for an unrated place.
    expect(p.rating).toBeNull();
    // Not asked for: undefined, as with Google's own library.
    expect(p.websiteURI).toBeUndefined();
    expect(p.toJSON()).toMatchObject({ id: "osm:node/123", location: { lat: 45.5231, lng: -122.6765 } });
  });

  it("fetchFields resolves for fields the search loaded and throws by name for the rest", async () => {
    const { Place } = await placeLib();
    const { places } = await Place.searchNearby({
      fields: ["displayName", "location"],
      locationRestriction: { center: { lat: 1, lng: 2 }, radius: 1000 },
      includedTypes: ["park"],
    });
    await expect(places[0].fetchFields({ fields: ["displayName"] })).resolves.toEqual({ place: places[0] });
    await expect(places[0].fetchFields({ fields: ["websiteURI"] })).rejects.toThrow(
      'Place.fetchFields for "websiteURI" is not available in the free map'
    );
    await expect(places[0].isOpen()).resolves.toBeUndefined();
  });

  it("refuses a request Google would refuse, in words", async () => {
    const { Place } = await placeLib();
    await expect(Place.searchNearby({ locationRestriction: { center: { lat: 1, lng: 2 }, radius: 10 } })).rejects.toThrow(
      "needs fields"
    );
    await expect(
      Place.searchNearby({
        fields: ["nickname"],
        locationRestriction: { center: { lat: 1, lng: 2 }, radius: 10 },
        includedTypes: ["park"],
      })
    ).rejects.toThrow('unknown Place field "nickname"');
    await expect(
      Place.searchNearby({
        fields: ["*"],
        locationRestriction: { center: { lat: 1, lng: 2 }, radius: 10 },
        includedTypes: ["park"],
        maxResultCount: 50,
      })
    ).rejects.toThrow("maxResultCount must be a whole number from 1 to 20");
  });

  it("a platform failure rejects with its sentence, never an empty list", async () => {
    const { Place } = await placeLib(Result.Err("The place search did not answer this time. Try again in a moment."));
    await expect(
      Place.searchNearby({
        fields: ["displayName"],
        locationRestriction: { center: { lat: 1, lng: 2 }, radius: 10 },
        includedTypes: ["park"],
      })
    ).rejects.toThrow("Place search failed: The place search did not answer this time.");
  });
});

describe("Place.searchByText", () => {
  it("turns locationBias into the search circle and passes the text through", async () => {
    const { h, Place } = await placeLib();
    await Place.searchByText({
      textQuery: "vegan bakery",
      fields: ["displayName"],
      locationBias: { center: new LatLng(45.5, -122.6), radius: 3000 },
      maxResultCount: 10,
    });
    expect(h.queries[0]).toEqual({
      search: "text",
      center: { lat: 45.5, lng: -122.6 },
      radius: 3000,
      textQuery: "vegan bakery",
      includedTypes: [],
      maxResultCount: 10,
    });
  });

  it("needs a place to search around, and says so", async () => {
    const { Place } = await placeLib();
    await expect(Place.searchByText({ textQuery: "pizza", fields: ["displayName"] })).rejects.toThrow(
      "needs locationBias or locationRestriction"
    );
  });

  it("filters the free map cannot apply throw by name instead of being ignored", async () => {
    const { Place } = await placeLib();
    const base = { textQuery: "coffee", fields: ["displayName"], locationBias: { lat: 1, lng: 2 } };
    await expect(Place.searchByText({ ...base, isOpenNow: true })).rejects.toThrow(
      "Place.searchByText isOpenNow is not available in the free map"
    );
    await expect(Place.searchByText({ ...base, minRating: 4 })).rejects.toThrow("minRating is not available in the free map");
  });
});
