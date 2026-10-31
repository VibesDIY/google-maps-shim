import type { Result } from "@adviser/cement";
import { LatLng, LatLngBounds, toLatLng, type LatLngBoundsLiteral, type LatLngLike, type LatLngLiteral } from "./core.js";
import { defineUnavailable, notInFreeMap } from "./errors.js";

// google.maps.places.Place, answered by the platform (never by a place vendor
// from the browser). Searches go out as one wire query; places come back in
// Google's field names and are handed to the app as Place objects carrying
// exactly the fields it asked for, the way Google's own library does.
//
// The same class serves both map modes. On a Google page (the real Maps
// JavaScript API) it is still this class, never Google's browser places
// library: every Places call goes through the platform, which meters it.
// Google places carry ratings, open-now and business status; OpenStreetMap
// places read `null` for them.

export type { PlacesQueryWire, PlaceWire, PlacesResultWire, MapMode } from "./places-wire.js";
import type { PlacesQueryWire, PlaceWire, PlacesResultWire, MapMode } from "./places-wire.js";

/** One search, carrying the page's map mode: only a Google page may get Google places. */
export type PlacesSearch = (query: PlacesQueryWire, mapMode: MapMode) => Promise<Result<PlacesResultWire>>;

/** Fields a platform answer fills (Google fills them all; OpenStreetMap the ones it holds). */
const FILLED_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "websiteURI",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "regularOpeningHours",
  "currentOpeningHours",
  "types",
  "primaryType",
  "primaryTypeDisplayName",
  "servesVegetarianFood",
  "attributions",
  "rating",
  "userRatingCount",
  "businessStatus",
  "googleMapsURI",
] as const;

/**
 * Real Place fields the platform does not fetch (in Google mode they sit in a
 * pricier SKU; OpenStreetMap does not carry them). Asking for one is fine; it
 * reads `null`, the way Google answers for a place without it. `rating`,
 * `userRatingCount`, `businessStatus` and `googleMapsURI` are filled in Google
 * mode and read `null` in free mode.
 */
const UNKNOWN_IN_FREE_MODE = [
  "priceLevel",
  "priceRange",
  "photos",
  "reviews",
  "editorialSummary",
  "generativeSummary",
  "shortFormattedAddress",
  "adrFormatAddress",
  "addressComponents",
  "plusCode",
  "viewport",
  "utcOffsetMinutes",
  "iconBackgroundColor",
  "svgIconMaskURI",
  "hasDelivery",
  "hasDineIn",
  "hasTakeout",
  "hasCurbsidePickup",
  "isReservable",
  "servesBreakfast",
  "servesLunch",
  "servesDinner",
  "servesBeer",
  "servesWine",
  "servesBrunch",
  "servesCoffee",
  "servesDessert",
  "hasOutdoorSeating",
  "hasLiveMusic",
  "hasMenuForChildren",
  "isGoodForChildren",
  "isGoodForGroups",
  "allowsDogs",
  "hasRestroom",
  "accessibilityOptions",
  "parkingOptions",
  "paymentOptions",
  "evChargeOptions",
  "fuelOptions",
] as const;

export interface OpeningHoursShape {
  /** Display lines: Google's own ("Monday: 9:00 AM – 5:00 PM"), or one per OpenStreetMap rule ("Mo-Fr 09:00-17:00"). */
  readonly weekdayDescriptions: readonly string[];
  /** Structured periods are not passed on; `place.isOpen()` answers open-now. */
  readonly periods: readonly never[];
}

function checkFields(fields: unknown, who: string): readonly string[] {
  if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => typeof f === "string")) {
    throw new Error(`${who} needs fields, e.g. fields: ["displayName", "location", "formattedAddress"]`);
  }
  if (fields.includes("*")) return [...FILLED_FIELDS, ...UNKNOWN_IN_FREE_MODE];
  const known = new Set<string>([...FILLED_FIELDS, ...UNKNOWN_IN_FREE_MODE]);
  const unknown = fields.filter((f) => !known.has(f));
  if (unknown.length > 0) throw new Error(`${who}: unknown Place field ${unknown.map((f) => `"${f}"`).join(", ")}`);
  return fields;
}

interface Circle {
  readonly center: LatLngLiteral;
  readonly radius: number;
}

interface CircleLike {
  getCenter(): LatLngLike;
  getRadius(): number;
}

/** Anything shaped like a google.maps.LatLngBounds, including Google's own native one in Google mode. */
interface BoundsLike {
  getNorthEast(): LatLngLike;
  getSouthWest(): LatLngLike;
}

type AreaInput = { center: LatLngLike; radius: number } | CircleLike | BoundsLike | LatLngBoundsLiteral | LatLngLike;

function isBoundsLike(v: unknown): v is BoundsLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as BoundsLike).getNorthEast === "function" &&
    typeof (v as BoundsLike).getSouthWest === "function"
  );
}

function isCircleLiteral(v: unknown): v is { center: LatLngLike; radius: number } {
  return typeof v === "object" && v !== null && "center" in v && typeof (v as { radius?: unknown }).radius === "number";
}

function isCircleLike(v: unknown): v is CircleLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CircleLike).getCenter === "function" &&
    typeof (v as CircleLike).getRadius === "function"
  );
}

function isBoundsLiteral(v: unknown): v is LatLngBoundsLiteral {
  return typeof v === "object" && v !== null && "north" in v && "south" in v && "east" in v && "west" in v;
}

/** Earth-surface meters between two points. */
function meters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat() - a.lat()) * rad;
  const dLng = (b.lng() - a.lng()) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat() * rad) * Math.cos(b.lat() * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** A circle for any of the area shapes Google accepts. A bare point gets `pointRadius`. */
function toCircle(area: AreaInput, pointRadius: number): Circle {
  if (isCircleLiteral(area)) return { center: toLatLng(area.center).toJSON(), radius: area.radius };
  // In Google mode circles and bounds may be Google's native objects (map.getBounds()),
  // so they are read through their methods and their points normalized with toLatLng.
  if (isCircleLike(area)) return { center: toLatLng(area.getCenter()).toJSON(), radius: area.getRadius() };
  if (isBoundsLike(area) || isBoundsLiteral(area)) {
    const b = isBoundsLike(area)
      ? new LatLngBounds(toLatLng(area.getSouthWest()), toLatLng(area.getNorthEast()))
      : new LatLngBounds(area);
    const center = b.getCenter();
    return { center: center.toJSON(), radius: Math.max(1, Math.round(meters(center, b.getNorthEast()))) };
  }
  return { center: toLatLng(area).toJSON(), radius: pointRadius };
}

/** The box Google's Text Search restricts to: a bounds as given, a circle (or point) by the box around it. */
function toBox(area: AreaInput, pointRadius: number): LatLngBoundsLiteral {
  if (isBoundsLike(area) || isBoundsLiteral(area)) {
    const sw = isBoundsLike(area) ? toLatLng(area.getSouthWest()) : new LatLng(area.south, area.west);
    const ne = isBoundsLike(area) ? toLatLng(area.getNorthEast()) : new LatLng(area.north, area.east);
    return { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() };
  }
  const c = toCircle(area, pointRadius);
  const dLat = c.radius / 111_320;
  const dLng = c.radius / (111_320 * Math.max(0.01, Math.cos((c.center.lat * Math.PI) / 180)));
  return {
    south: Math.max(-90, c.center.lat - dLat),
    west: c.center.lng - dLng,
    north: Math.min(90, c.center.lat + dLat),
    east: c.center.lng + dLng,
  };
}

function maxCount(v: unknown, who: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 20)
    throw new Error(`${who}: maxResultCount must be a whole number from 1 to 20`);
  return v;
}

export interface SearchNearbyRequest {
  readonly fields: readonly string[];
  readonly locationRestriction: AreaInput;
  readonly includedPrimaryTypes?: readonly string[];
  readonly includedTypes?: readonly string[];
  readonly excludedPrimaryTypes?: readonly string[];
  readonly excludedTypes?: readonly string[];
  readonly maxResultCount?: number;
  readonly rankPreference?: string;
  readonly language?: string;
  readonly region?: string;
}

export interface SearchByTextRequest {
  readonly textQuery: string;
  readonly fields: readonly string[];
  readonly locationBias?: AreaInput;
  readonly locationRestriction?: AreaInput;
  readonly includedType?: string;
  readonly maxResultCount?: number;
  readonly isOpenNow?: boolean;
  readonly minRating?: number;
  readonly priceLevels?: readonly string[];
  readonly useStrictTypeFiltering?: boolean;
  readonly rankPreference?: string;
  readonly language?: string;
  readonly region?: string;
}

/** The searchByText bias radius when the app passes a bare point. */
const POINT_BIAS_RADIUS = 5000;

export function nearbyQuery(req: SearchNearbyRequest): { readonly query: PlacesQueryWire; readonly fields: readonly string[] } {
  const who = "Place.searchNearby";
  const fields = checkFields(req.fields, who);
  if (req.locationRestriction === undefined || req.locationRestriction === null) {
    throw new Error(`${who} needs locationRestriction: { center, radius }`);
  }
  const circle = toCircle(req.locationRestriction, POINT_BIAS_RADIUS);
  // The four type lists go out as the app wrote them: Google treats primary and
  // plain types differently, and the free map merges them on the server.
  const list = (v: readonly string[] | undefined): string[] => [...new Set(v ?? [])];
  const lists = {
    includedTypes: list(req.includedTypes),
    excludedTypes: list(req.excludedTypes),
    includedPrimaryTypes: list(req.includedPrimaryTypes),
    excludedPrimaryTypes: list(req.excludedPrimaryTypes),
  };
  const max = maxCount(req.maxResultCount, who);
  return {
    fields,
    query: {
      search: "nearby",
      center: circle.center,
      radius: circle.radius,
      includedTypes: lists.includedTypes,
      ...(lists.excludedTypes.length === 0 ? {} : { excludedTypes: lists.excludedTypes }),
      ...(lists.includedPrimaryTypes.length === 0 ? {} : { includedPrimaryTypes: lists.includedPrimaryTypes }),
      ...(lists.excludedPrimaryTypes.length === 0 ? {} : { excludedPrimaryTypes: lists.excludedPrimaryTypes }),
      ...(max === undefined ? {} : { maxResultCount: max }),
    },
  };
}

/** The Google-only filters of searchByText, on the wire. The free map cannot apply them, so it refuses them by name. */
function googleFilters(req: SearchByTextRequest, mode: MapMode, who: string): Partial<PlacesQueryWire> {
  const priceLevels = req.priceLevels ?? [];
  if (mode === "free") {
    if (req.isOpenNow === true) throw notInFreeMap(`${who} isOpenNow`);
    if (req.minRating !== undefined) throw notInFreeMap(`${who} minRating`);
    if (priceLevels.length > 0) throw notInFreeMap(`${who} priceLevels`);
    return {};
  }
  return {
    ...(req.isOpenNow === true ? { openNow: true } : {}),
    ...(req.minRating === undefined ? {} : { minRating: req.minRating }),
    ...(priceLevels.length === 0 ? {} : { priceLevels: [...priceLevels] }),
  };
}

export function textQuery(
  req: SearchByTextRequest,
  mode: MapMode = "free"
): { readonly query: PlacesQueryWire; readonly fields: readonly string[] } {
  const who = "Place.searchByText";
  const fields = checkFields(req.fields, who);
  if (typeof req.textQuery !== "string" || req.textQuery.trim() === "") throw new Error(`${who} needs a textQuery`);
  const filters = googleFilters(req, mode, who);
  const area = req.locationRestriction ?? req.locationBias;
  if (area === undefined || area === null) {
    throw new Error(`${who} needs locationBias or locationRestriction, e.g. locationBias: { center, radius: 5000 }`);
  }
  const circle = toCircle(area, POINT_BIAS_RADIUS);
  const restriction = req.locationRestriction;
  const max = maxCount(req.maxResultCount, who);
  return {
    fields,
    query: {
      search: "text",
      center: circle.center,
      radius: circle.radius,
      // A restriction stays one: Google's Text Search restricts to a rectangle only.
      ...(restriction === undefined || restriction === null ? {} : { restrictTo: toBox(restriction, POINT_BIAS_RADIUS) }),
      textQuery: req.textQuery.trim(),
      includedTypes: req.includedType === undefined ? [] : [req.includedType],
      ...(max === undefined ? {} : { maxResultCount: max }),
      ...filters,
    },
  };
}

function typeDisplayName(type: string | undefined): string | null {
  if (type === undefined) return null;
  const words = type.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PROVIDER_URI: Readonly<Record<MapMode, string>> = {
  free: "https://www.openstreetmap.org/copyright",
  google: "https://www.google.com/maps",
};

export interface PlacesLibraryDeps {
  readonly search: PlacesSearch;
  /** The page's map mode, settled before this library is handed to the app. */
  readonly mapMode: () => MapMode;
  /**
   * OpenStreetMap places were handed to an app on a Google page. Their licence
   * needs a visible credit whatever fields the app asked for, so the loader
   * puts one on the Google map.
   */
  readonly onFreePlacesOnGoogle?: () => void;
}

export function createPlacesLibrary(deps: PlacesLibraryDeps) {
  class Place {
    id: string;
    displayName?: string | null;
    formattedAddress?: string | null;
    location?: LatLng | null;
    websiteURI?: string | null;
    nationalPhoneNumber?: string | null;
    internationalPhoneNumber?: string | null;
    regularOpeningHours?: OpeningHoursShape | null;
    currentOpeningHours?: OpeningHoursShape | null;
    types?: string[];
    primaryType?: string | null;
    primaryTypeDisplayName?: string | null;
    servesVegetarianFood?: boolean | null;
    rating?: number | null;
    userRatingCount?: number | null;
    businessStatus?: string | null;
    googleMapsURI?: string | null;
    attributions?: { provider: string; providerURI: string | null }[];
    /** Which source answered: "google" (Places API) or "free" (OpenStreetMap). */
    mapMode: MapMode = "free";
    readonly #loaded = new Set<string>();
    #openNow: boolean | undefined = undefined;

    constructor(opts: { id: string; requestedLanguage?: string; requestedRegion?: string }) {
      if (typeof opts?.id !== "string" || opts.id === "") throw new Error("new Place({ id }) needs an id");
      this.id = opts.id;
      this.#loaded.add("id");
    }

    /** Copy the requested fields from a platform answer, Google style: unrequested fields stay undefined. */
    static fromWire(wire: PlaceWire, fields: readonly string[], attribution: string, source: MapMode = "free"): Place {
      const place = new Place({ id: wire.id });
      place.mapMode = source;
      place.#openNow = wire.openNow;
      const hours: OpeningHoursShape | null =
        wire.openingHoursText === undefined ? null : { weekdayDescriptions: [...wire.openingHoursText], periods: [] };
      const values: Record<string, unknown> = {
        displayName: wire.displayName,
        formattedAddress: wire.formattedAddress ?? null,
        location: new LatLng(wire.location.lat, wire.location.lng),
        websiteURI: wire.websiteURI ?? null,
        nationalPhoneNumber: wire.nationalPhoneNumber ?? null,
        internationalPhoneNumber: wire.nationalPhoneNumber ?? null,
        regularOpeningHours: hours,
        currentOpeningHours: hours,
        types: [...wire.types],
        primaryType: wire.primaryType ?? null,
        primaryTypeDisplayName: typeDisplayName(wire.primaryType),
        servesVegetarianFood: wire.servesVegetarianFood ?? null,
        rating: wire.rating ?? null,
        userRatingCount: wire.userRatingCount ?? null,
        businessStatus: wire.businessStatus ?? null,
        googleMapsURI: wire.googleMapsURI ?? null,
        attributions: [{ provider: attribution, providerURI: PROVIDER_URI[source] }],
      };
      for (const field of fields) {
        if (field === "id") continue;
        (place as unknown as Record<string, unknown>)[field] = field in values ? values[field] : null;
        place.#loaded.add(field);
      }
      return place;
    }

    static async searchNearby(req: SearchNearbyRequest): Promise<{ places: Place[] }> {
      const { query, fields } = nearbyQuery(req);
      return Place.#run(query, fields);
    }

    static async searchByText(req: SearchByTextRequest): Promise<{ places: Place[] }> {
      const { query, fields } = textQuery(req, deps.mapMode());
      return Place.#run(query, fields);
    }

    static async #run(query: PlacesQueryWire, fields: readonly string[]): Promise<{ places: Place[] }> {
      const pageMode = deps.mapMode();
      const r = await deps.search(query, pageMode);
      if (r.isErr()) throw new Error(`Place search failed: ${r.Err().message}`);
      const result = r.Ok();
      // A free page shows OpenStreetMap places only, whatever comes back: Google's places belong on Google's map.
      if (pageMode === "free" && result.mode === "google") throw new Error("Place search failed: Google places on a free map");
      if (pageMode === "google" && result.mode === "free" && result.places.length > 0) deps.onFreePlacesOnGoogle?.();
      return { places: result.places.map((p) => Place.fromWire(p, fields, result.attribution, result.mode)) };
    }

    /**
     * A place from a search already holds what that search asked for; asking
     * again for those fields resolves at once. A details lookup by id is not in
     * the free map, so a field the search did not load throws by name.
     */
    async fetchFields(opts: { fields: readonly string[] }): Promise<{ place: Place }> {
      const fields = checkFields(opts?.fields, "Place.fetchFields");
      const missing = fields.filter((f) => !this.#loaded.has(f));
      if (missing.length > 0) {
        throw new Error(
          `Place.fetchFields for ${missing.map((f) => `"${f}"`).join(", ")} is not available in the free map: ask for every field you need in searchNearby / searchByText`
        );
      }
      return { place: this };
    }

    /**
     * Open now, as Google's places answer it at search time. An OpenStreetMap
     * place answers `undefined` (its hours are shown as text, not evaluated), so
     * an "Open now" filter keeps it and shows its hours.
     */
    async isOpen(): Promise<boolean | undefined> {
      return this.#openNow;
    }

    toJSON(): Record<string, unknown> {
      const out: Record<string, unknown> = { id: this.id };
      for (const field of this.#loaded) {
        const v = (this as unknown as Record<string, unknown>)[field];
        out[field] = v instanceof LatLng ? v.toJSON() : v;
      }
      return out;
    }
  }
  defineUnavailable(Place, ["searchByTextQuery", "fetchPlaceDetails"], "Place.");
  defineUnavailable(Place.prototype, ["getNextOpeningTime"], "Place.");

  const places: Record<string, unknown> = { Place };
  defineUnavailable(
    places,
    [
      "Autocomplete",
      "AutocompleteService",
      "AutocompleteSessionToken",
      "AutocompleteSuggestion",
      "PlaceAutocompleteElement",
      "PlacesService",
      "SearchBox",
      "PlaceDetailsElement",
      "PlaceListElement",
      "PlaceSearchElement",
    ],
    "places."
  );
  return places as { Place: typeof Place };
}
