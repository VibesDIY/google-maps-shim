import { exception2Result, KeyedResolvOnce, Result, URI } from "@adviser/cement";
import type { PlacesQueryWire, PlaceWire as PlaceWireReadonly } from "./places.js";

// The free half of the Places API (#8104): OpenStreetMap places answered in
// Google Places (New) field names, so `Place.searchNearby` reads one shape in
// either mode. Geoapify's hosted copy of OSM when a Geoapify key is given (it
// answers steadily), else the public Overpass mirrors. Pure apart from the
// injected fetch, so it runs the same on a server (the vibes.diy platform
// search, api/svc/intern/places-free.ts) and in a browser (the standalone
// entry, standalone.ts). Tests: test/osm-places.test.ts.

type PlacesSearchQuery = PlacesQueryWire;
type Writable<V> = V extends readonly (infer U)[] ? U[] : V;
/** One OpenStreetMap place in Google Places (New) field names (the shim's PlaceWire, with plain arrays). */
export type PlaceWire = { -readonly [K in keyof PlaceWireReadonly]: Writable<PlaceWireReadonly[K]> };
/** A free-mode answer: always `free`, from Geoapify or Overpass. */
export interface PlacesSearchResult {
  readonly mode: "free";
  readonly source: "geoapify" | "overpass";
  readonly attribution: string;
  readonly places: PlaceWire[];
}

export const FREE_PLACES_ATTRIBUTION = "© OpenStreetMap contributors";

// ── Google place types → OpenStreetMap tags / Geoapify categories ─────────

interface TagTest {
  readonly key: string;
  /** Any of these values; omitted = the key just has to be present. */
  readonly values?: readonly string[];
}

export interface FreePlaceType {
  /** Every tag test must hold. */
  readonly osm: readonly TagTest[];
  readonly geoapifyCategories: readonly string[];
  /** Geoapify `conditions` (applied to the whole request, so grouped per value). */
  readonly geoapifyConditions?: string;
  /** Plain words that pick this type out of a searchByText query. */
  readonly words: readonly string[];
}

const FOOD_PLACES = ["restaurant", "cafe", "fast_food"];
const VEGAN = ["only", "yes"];

/**
 * Google place type → how OpenStreetMap and Geoapify say it. A type missing
 * here is refused by name (see `unknownPlaceTypes`), never widened to "any
 * place". Add a row to support one more.
 */
export const FREE_PLACE_TYPES: Readonly<Record<string, FreePlaceType>> = {
  vegan_restaurant: {
    osm: [
      { key: "amenity", values: FOOD_PLACES },
      { key: "diet:vegan", values: VEGAN },
    ],
    geoapifyCategories: ["catering.restaurant", "catering.cafe", "catering.fast_food"],
    geoapifyConditions: "vegan",
    // "vegan" in a text query is a diet QUALIFIER (DIET_QUALIFIERS), not this type.
    words: [],
  },
  vegetarian_restaurant: {
    osm: [
      { key: "amenity", values: FOOD_PLACES },
      { key: "diet:vegetarian", values: VEGAN },
    ],
    geoapifyCategories: ["catering.restaurant", "catering.cafe", "catering.fast_food"],
    geoapifyConditions: "vegetarian",
    words: [],
  },
  restaurant: {
    osm: [{ key: "amenity", values: ["restaurant"] }],
    geoapifyCategories: ["catering.restaurant"],
    words: ["restaurant", "restaurants", "food", "dinner", "lunch"],
  },
  fast_food_restaurant: {
    osm: [{ key: "amenity", values: ["fast_food"] }],
    geoapifyCategories: ["catering.fast_food"],
    words: ["fast food", "burger", "burgers"],
  },
  cafe: {
    osm: [{ key: "amenity", values: ["cafe"] }],
    geoapifyCategories: ["catering.cafe"],
    words: ["cafe", "cafes", "café", "cafés"],
  },
  coffee_shop: {
    osm: [{ key: "amenity", values: ["cafe"] }],
    geoapifyCategories: ["catering.cafe"],
    words: ["coffee", "espresso"],
  },
  bakery: {
    osm: [{ key: "shop", values: ["bakery"] }],
    geoapifyCategories: ["commercial.food_and_drink.bakery"],
    words: ["bakery", "bakeries", "bread", "pastry"],
  },
  ice_cream_shop: {
    osm: [{ key: "amenity", values: ["ice_cream"] }],
    geoapifyCategories: ["catering.ice_cream"],
    words: ["ice cream", "gelato"],
  },
  bar: {
    osm: [{ key: "amenity", values: ["bar", "pub"] }],
    geoapifyCategories: ["catering.bar", "catering.pub"],
    words: ["bar", "bars", "pub", "pubs", "drinks"],
  },
  park: {
    osm: [{ key: "leisure", values: ["park"] }],
    geoapifyCategories: ["leisure.park"],
    words: ["park", "parks"],
  },
  dog_park: {
    osm: [{ key: "leisure", values: ["dog_park"] }],
    geoapifyCategories: ["pet.dog_park"],
    words: ["dog park", "dog parks", "off-leash"],
  },
  playground: {
    osm: [{ key: "leisure", values: ["playground"] }],
    geoapifyCategories: ["leisure.playground"],
    words: ["playground", "playgrounds"],
  },
  museum: {
    osm: [{ key: "tourism", values: ["museum"] }],
    geoapifyCategories: ["entertainment.museum"],
    words: ["museum", "museums"],
  },
  tourist_attraction: {
    osm: [{ key: "tourism", values: ["attraction"] }],
    geoapifyCategories: ["tourism.attraction"],
    words: ["attraction", "attractions", "sights"],
  },
  library: {
    osm: [{ key: "amenity", values: ["library"] }],
    geoapifyCategories: ["education.library"],
    words: ["library", "libraries"],
  },
  book_store: {
    osm: [{ key: "shop", values: ["books"] }],
    geoapifyCategories: ["commercial.books"],
    words: ["bookstore", "bookstores", "book shop", "books"],
  },
  supermarket: {
    osm: [{ key: "shop", values: ["supermarket"] }],
    geoapifyCategories: ["commercial.supermarket"],
    words: ["supermarket", "grocery", "groceries"],
  },
  grocery_store: {
    osm: [{ key: "shop", values: ["supermarket", "greengrocer", "convenience"] }],
    geoapifyCategories: ["commercial.supermarket"],
    words: [],
  },
  pharmacy: {
    osm: [{ key: "amenity", values: ["pharmacy"] }],
    geoapifyCategories: ["healthcare.pharmacy"],
    words: ["pharmacy", "pharmacies", "drugstore"],
  },
  gym: {
    osm: [{ key: "leisure", values: ["fitness_centre"] }],
    geoapifyCategories: ["sport.fitness.fitness_centre"],
    words: ["gym", "gyms", "fitness"],
  },
};

export function unknownPlaceTypes(types: readonly string[]): string[] {
  // Own keys only: "constructor" or "__proto__" is not a kind of place.
  return types.filter((t) => !Object.hasOwn(FREE_PLACE_TYPES, t));
}

export type Diet = "vegan" | "vegetarian";

/**
 * Diet words in a text query QUALIFY the places, never add a kind of place:
 * "vegan restaurants" is restaurants that are vegan, an intersection.
 */
export const DIET_QUALIFIERS: Readonly<
  Record<Diet, { readonly words: readonly string[]; readonly osmKey: string; readonly type: string }>
> = {
  vegan: { words: ["vegan"], osmKey: "diet:vegan", type: "vegan_restaurant" },
  vegetarian: { words: ["vegetarian", "veggie"], osmKey: "diet:vegetarian", type: "vegetarian_restaurant" },
};

export interface ParsedText {
  /** Kinds of place the text names ("dog parks" → dog_park). */
  readonly types: string[];
  /** Diet qualifiers, applied to every result. */
  readonly diets: Diet[];
  /** The text with category and diet words taken out, e.g. a place's name. */
  readonly rest: string;
}

function normalized(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Split a searchByText query into place kinds, diet qualifiers and what is left. Longest phrase first, so "dog park" wins over "park". */
export function parseTextQuery(text: string): ParsedText {
  const hits: { readonly word: string; readonly type?: string; readonly diet?: Diet }[] = [];
  for (const [type, row] of Object.entries(FREE_PLACE_TYPES)) {
    for (const word of row.words) hits.push({ word, type });
  }
  for (const [diet, row] of Object.entries(DIET_QUALIFIERS) as [Diet, (typeof DIET_QUALIFIERS)[Diet]][]) {
    for (const word of row.words) hits.push({ word, diet });
  }
  hits.sort((a, b) => b.word.length - a.word.length);
  const types: string[] = [];
  const diets: Diet[] = [];
  let scan = normalized(text);
  // `rest` keeps the original spelling ("Powell's"), so it can match a name.
  let rest = ` ${text.trim()} `;
  for (const hit of hits) {
    const needle = ` ${hit.word} `;
    if (!scan.includes(needle)) continue;
    if (hit.type !== undefined && !types.includes(hit.type)) types.push(hit.type);
    if (hit.diet !== undefined && !diets.includes(hit.diet)) diets.push(hit.diet);
    scan = scan.split(needle).join(" ");
    rest = rest.replace(new RegExp(`(?<=\\s)${escapeRegExp(hit.word)}(?=\\s)`, "giu"), " ");
  }
  // "… in Portland": where is the search's center, not part of a name.
  rest = rest.replace(/\s(?:in|near|around)\s.*$/iu, " ");
  for (const word of FILLER_WORDS) rest = rest.replace(new RegExp(`(?<=\\s)${escapeRegExp(word)}(?=\\s)`, "giu"), " ");
  return { types, diets, rest: rest.replace(/\s+/g, " ").trim() };
}

/** Words that say where or how good, not what: dropped before the rest is read as a name. */
const FILLER_WORDS = [
  "near me",
  "nearby",
  "near",
  "around",
  "local",
  "best",
  "top",
  "good",
  "the",
  "a",
  "in",
  "places",
  "spots",
  "open now",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The place kinds a searchByText query names (diet words qualify, so they are not here). */
export function typesFromText(text: string): string[] {
  return parseTextQuery(text).types;
}

function tagHolds(tags: Readonly<Record<string, string>>, test: TagTest): boolean {
  const value = tags[test.key];
  if (value === undefined) return false;
  if (test.values === undefined) return true;
  return value.split(";").some((v) => test.values?.includes(v.trim()) === true);
}

/** Every table type an OSM element's tags satisfy, in table order. */
export function googleTypesForTags(tags: Readonly<Record<string, string>>): string[] {
  return Object.entries(FREE_PLACE_TYPES)
    .filter(([, row]) => row.osm.every((test) => tagHolds(tags, test)))
    .map(([type]) => type);
}

// ── Search area, rounded so nearby viewers share a cached answer ──────────

const RADIUS_BUCKETS = [500, 1000, 2000, 5000, 10000, 20000, 50000];
/** ~1.1 km of latitude: the rounding grid for the shared answer. */
const GRID_DEGREES = 0.01;
/** The rounded point can sit up to ~800 m from the real one, so the upstream circle grows by that much. */
const GRID_SLACK_METERS = 800;
export const MAX_UPSTREAM_RESULTS = 200;

export interface SearchArea {
  readonly lat: number;
  readonly lng: number;
  /** Upstream circle: the radius bucket plus the grid slack. */
  readonly radius: number;
}

export function roundedSearchArea(query: Pick<PlacesSearchQuery, "center" | "radius">): SearchArea {
  const bucket = RADIUS_BUCKETS.find((b) => b >= query.radius) ?? RADIUS_BUCKETS[RADIUS_BUCKETS.length - 1];
  const round = (v: number) => Math.round(v / GRID_DEGREES) * GRID_DEGREES;
  return {
    lat: Number(round(query.center.lat).toFixed(2)),
    lng: Number(round(query.center.lng).toFixed(2)),
    radius: bucket + GRID_SLACK_METERS,
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Problems with a query, phrased for the app developer. Empty = valid. In
 * Google mode any Google place type is fine and searchNearby may name none; the
 * free map knows the types in FREE_PLACE_TYPES and needs one.
 */
/**
 * The free map's two type lists. OpenStreetMap has no "primary" type, so the
 * primary-type filters join the plain ones here; Google gets them apart.
 */
export function freeTypeLists(query: PlacesSearchQuery): { readonly included: string[]; readonly excluded: string[] } {
  return {
    included: [...new Set([...(query.includedPrimaryTypes ?? []), ...(query.includedTypes ?? [])])],
    excluded: [...new Set([...(query.excludedPrimaryTypes ?? []), ...(query.excludedTypes ?? [])])],
  };
}

export function placesQueryProblems(query: PlacesSearchQuery, mode: "free" | "google" = "free"): string[] {
  const problems: string[] = [];
  const { lat, lng } = query.center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    problems.push("center needs a finite lat (-90..90) and lng (-180..180)");
  }
  if (!Number.isFinite(query.radius) || query.radius <= 0 || query.radius > 50000) {
    problems.push("radius must be between 1 and 50000 meters");
  }
  const max = query.maxResultCount;
  if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 20)) {
    problems.push("maxResultCount must be a whole number from 1 to 20");
  }
  if (query.search === "text" && (query.textQuery ?? "").trim() === "") {
    problems.push("searchByText needs a textQuery");
  }
  if (mode === "google") return problems;
  // Google's filters have no free-map equivalent, so they are refused in the shim's words
  // rather than dropped: an unfiltered answer would pass for an honoured filter.
  const who = query.search === "text" ? "Place.searchByText" : "Place.searchNearby";
  if (query.openNow === true) problems.push(`${who} isOpenNow is not available in the free map`);
  if (query.minRating !== undefined) problems.push(`${who} minRating is not available in the free map`);
  if ((query.priceLevels ?? []).length > 0) problems.push(`${who} priceLevels is not available in the free map`);
  const types = freeTypeLists(query);
  const unknown = unknownPlaceTypes([...types.included, ...types.excluded]);
  if (unknown.length > 0) {
    problems.push(
      `place type ${unknown.map((t) => `"${t}"`).join(", ")} is not available in the free map; it knows ${Object.keys(FREE_PLACE_TYPES).join(", ")}`
    );
  }
  if (query.search === "nearby" && types.included.length === 0) {
    problems.push("searchNearby in the free map needs includedPrimaryTypes or includedTypes naming what to find");
  }
  return problems;
}

// ── One OSM-ish element, from either source ────────────────────────────────

export interface OsmElement {
  /** `osm:node/123` style, or `geoapify:<id>`. */
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly tags: Readonly<Record<string, string>>;
  /** A ready-made address line, when the source gives one. */
  readonly formatted?: string;
}

const OSM_TYPE_NAMES: Readonly<Record<string, string>> = {
  n: "node",
  w: "way",
  r: "relation",
  node: "node",
  way: "way",
  relation: "relation",
};

function stringTags(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number") out[k] = String(v);
  }
  return out;
}

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Overpass `out body center` elements → OsmElement. Nodes carry `lat`/`lon`; ways and relations carry `center`. */
export function overpassElements(body: unknown): OsmElement[] {
  const elements = (body as { readonly elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: OsmElement[] = [];
  for (const el of elements as Record<string, unknown>[]) {
    const type = OSM_TYPE_NAMES[String(el.type)];
    const center = (el.center ?? {}) as Record<string, unknown>;
    const lat = finite(el.lat) ?? finite(center.lat);
    const lng = finite(el.lon) ?? finite(center.lon);
    if (type === undefined || lat === undefined || lng === undefined || el.id === undefined) continue;
    out.push({ id: `osm:${type}/${String(el.id)}`, lat, lng, tags: stringTags(el.tags) });
  }
  return out;
}

/** Geoapify `/v2/places` features → OsmElement. `datasource.raw` carries the OSM tags and identity. */
export function geoapifyElements(body: unknown): OsmElement[] {
  const features = (body as { readonly features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: OsmElement[] = [];
  for (const f of features as { readonly properties?: Record<string, unknown> }[]) {
    const p = f.properties ?? {};
    const raw = ((p.datasource as Record<string, unknown> | undefined)?.raw ?? {}) as Record<string, unknown>;
    const lat = finite(p.lat);
    const lng = finite(p.lon);
    if (lat === undefined || lng === undefined) continue;
    const osmType = OSM_TYPE_NAMES[String(raw.osm_type)];
    const osmId = raw.osm_id;
    const id =
      osmType !== undefined && (typeof osmId === "number" || typeof osmId === "string")
        ? `osm:${osmType}/${String(osmId)}`
        : `geoapify:${String(p.place_id)}`;
    const tags = stringTags(raw);
    if (tags.name === undefined && typeof p.name === "string") tags.name = p.name;
    if (tags.website === undefined && typeof p.website === "string") tags.website = p.website;
    if (tags.opening_hours === undefined && typeof p.opening_hours === "string") tags.opening_hours = p.opening_hours;
    out.push({ id, lat, lng, tags, ...(typeof p.formatted === "string" ? { formatted: p.formatted } : {}) });
  }
  return out;
}

// ── OsmElement → Google-shaped place ───────────────────────────────────────

export function distanceMeters(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number }
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

function addressFromTags(tags: Readonly<Record<string, string>>): string | undefined {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter((v) => v !== undefined).join(" ");
  const cityLine = [tags["addr:city"], [tags["addr:state"], tags["addr:postcode"]].filter((v) => v !== undefined).join(" ")]
    .filter((v) => v !== undefined && v !== "")
    .join(", ");
  const line = [street, cityLine].filter((v) => v !== "").join(", ");
  return line === "" ? undefined : line;
}

function websiteFromTags(tags: Readonly<Record<string, string>>): string | undefined {
  const raw = tags.website ?? tags["contact:website"] ?? tags.url;
  if (raw === undefined) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return /^https?:\/\/[^\s]+$/i.test(withScheme) ? withScheme : undefined;
}

/** Google's place for one OSM element, or undefined for an unnamed one (Google never lists those). */
export function toPlaceWire(el: OsmElement, center: { readonly lat: number; readonly lng: number }): PlaceWire | undefined {
  const name = el.tags.name?.trim();
  if (name === undefined || name === "") return undefined;
  const types = googleTypesForTags(el.tags);
  const phone = el.tags.phone ?? el.tags["contact:phone"];
  const hours = el.tags.opening_hours
    ?.split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const address = addressFromTags(el.tags) ?? el.formatted;
  const website = websiteFromTags(el.tags);
  const vegetarian = ["diet:vegan", "diet:vegetarian"].some((k) => VEGAN.includes(el.tags[k] ?? ""));
  return {
    id: el.id,
    displayName: name,
    location: { lat: el.lat, lng: el.lng },
    types,
    ...(types[0] === undefined ? {} : { primaryType: types[0] }),
    ...(address === undefined ? {} : { formattedAddress: address }),
    ...(website === undefined ? {} : { websiteURI: website }),
    ...(phone === undefined ? {} : { nationalPhoneNumber: phone }),
    ...(hours === undefined || hours.length === 0 ? {} : { openingHoursText: hours }),
    ...(vegetarian ? { servesVegetarianFood: true } : {}),
    distanceMeters: Math.round(distanceMeters(center, el)),
  };
}

// ── Upstream queries ───────────────────────────────────────────────────────

export const OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
export const GEOAPIFY_PLACES_URL = "https://api.geoapify.com/v2/places";
/** Each upstream call is aborted after this; a place search is read-only, so abandoning it is safe. */
const UPSTREAM_DEADLINE_MS = 12_000;
/**
 * The whole search, every mirror and every Geoapify page together, finishes
 * inside this. The app's request gives up after 30s with no message back, and
 * nothing is sent until the answer, so the server must answer first.
 */
export const SEARCH_BUDGET_MS = 24_000;
/** Overpass's own `[timeout:]`, under the per-call deadline so a busy mirror says so before we abandon it. */
const OVERPASS_QUERY_TIMEOUT_S = 10;

/**
 * What one upstream search asks for. Types are a union (any of these kinds);
 * `diets` and `name` narrow every one of them (an intersection).
 */
export interface UpstreamAsk {
  readonly types: readonly string[];
  /** Diet qualifiers every result must carry (`diet:vegan=only|yes`). */
  readonly diets: readonly Diet[];
  /** Case-insensitive name match, when searchByText's text is a name rather than a kind of place. */
  readonly name?: string;
}

/**
 * searchByText's text keeps its meaning (#8113 review): a diet word qualifies
 * the kinds of place, and text that names no kind of place is a name to match,
 * even when the app also passed an includedType ("Blossoming Lotus" +
 * restaurant is that restaurant, not every restaurant).
 */
export function upstreamAsk(query: PlacesSearchQuery): UpstreamAsk {
  const included = freeTypeLists(query).included;
  if (query.search !== "text") return { types: included, diets: [] };
  const parsed = parseTextQuery(query.textQuery ?? "");
  const name = nameFromRest(parsed);
  const textTypes =
    parsed.types.length > 0
      ? parsed.types
      : name === undefined
        ? parsed.diets.map((diet) => DIET_QUALIFIERS[diet].type) // "vegan" alone: places serving vegan food
        : [];
  const types = included.length > 0 ? included : textTypes;
  return { types, diets: parsed.diets, ...(name === undefined ? {} : { name }) };
}

/**
 * What is left after the kinds of place is a name when nothing else was named,
 * or when it is written like one ("Powell's Books" keeps "Powell's"). Lower-case
 * leftovers beside a kind of place are a wish, not a name ("cheap coffee"), and
 * matching them as a name would empty the results.
 */
function nameFromRest(parsed: ParsedText): string | undefined {
  if (parsed.rest === "") return undefined;
  if (parsed.types.length === 0) return parsed.rest;
  return /\p{Lu}/u.test(parsed.rest) ? parsed.rest : undefined;
}

function escapeOverpassRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&");
}

function overpassTest(test: TagTest): string {
  return test.values === undefined ? `["${test.key}"]` : `["${test.key}"~"^(${test.values.map(escapeOverpassRegex).join("|")})$"]`;
}

export function overpassQuery(args: { readonly area: SearchArea; readonly ask: UpstreamAsk }): string {
  const around = `(around:${args.area.radius},${args.area.lat},${args.area.lng})`;
  // The narrowing every clause carries: each diet, then the name.
  const narrow =
    args.ask.diets.map((diet) => overpassTest({ key: DIET_QUALIFIERS[diet].osmKey, values: VEGAN })).join("") +
    (args.ask.name === undefined ? "" : `["name"~"${escapeOverpassRegex(args.ask.name)}",i]`);
  const clauses =
    args.ask.types.length > 0
      ? args.ask.types.map((t) => `nwr${FREE_PLACE_TYPES[t].osm.map(overpassTest).join("")}${narrow}${around};`)
      : [`nwr["name"]${narrow}${around};`];
  // `body` keeps a node's own lat/lon (most shops and restaurants are nodes); `center` gives ways and relations one.
  return `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${clauses.join("")});out body center ${MAX_UPSTREAM_RESULTS};`;
}

/** Whether one element satisfies the ask's intersection (diets and name). Applied to every answer, whatever the source. */
export function satisfiesAsk(el: OsmElement, ask: UpstreamAsk): boolean {
  const dietOk = ask.diets.every((diet) => tagHolds(el.tags, { key: DIET_QUALIFIERS[diet].osmKey, values: VEGAN }));
  const nameOk = ask.name === undefined || (el.tags.name ?? "").toLowerCase().includes(ask.name.toLowerCase());
  return dietOk && nameOk;
}

/** One Geoapify request per distinct `conditions` value, since conditions apply to every category in a request. */
export function geoapifyUrls(args: { readonly area: SearchArea; readonly ask: UpstreamAsk; readonly apiKey: string }): string[] {
  const filter = `circle:${args.area.lng},${args.area.lat},${args.area.radius}`;
  const groups = new Map<string, Set<string>>();
  if (args.ask.types.length === 0) {
    groups.set("", new Set(["catering", "commercial", "leisure", "tourism", "entertainment", "education"]));
  }
  for (const t of args.ask.types) {
    const row = FREE_PLACE_TYPES[t];
    const key = row.geoapifyConditions ?? "";
    const set = groups.get(key) ?? new Set<string>();
    row.geoapifyCategories.forEach((c) => set.add(c));
    groups.set(key, set);
  }
  // Diet qualifiers narrow every group (and satisfiesAsk re-checks the tags after).
  const conditionsFor = (own: string): string => [...new Set([own, ...args.ask.diets].filter((c) => c !== ""))].join(",");
  return [...groups.entries()].map(([conditions, categories]) => {
    const params = new URLSearchParams({
      categories: [...categories].join(","),
      filter,
      bias: `proximity:${args.area.lng},${args.area.lat}`,
      limit: String(MAX_UPSTREAM_RESULTS),
      apiKey: args.apiKey,
    });
    const merged = conditionsFor(conditions);
    if (merged !== "") params.set("conditions", merged);
    if (args.ask.name !== undefined) params.set("name", args.ask.name);
    return `${GEOAPIFY_PLACES_URL}?${params.toString()}`;
  });
}

export type PlacesFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** How long one upstream call may take: its own cap, cut to what is left of the search's budget. */
export function attemptDeadlineMs(args: { readonly deadline: number; readonly now: number }): number {
  return Math.max(0, Math.min(UPSTREAM_DEADLINE_MS, args.deadline - args.now));
}

/**
 * Overpass answers 200 with a `remark` when the query ran out of time or memory,
 * and the elements are then empty or partial. That is a failure: try the next
 * mirror, and keep nothing.
 */
export function overpassRemarkError(body: unknown): string | undefined {
  const remark = (body as { readonly remark?: unknown } | null)?.remark;
  if (typeof remark !== "string") return undefined;
  return /error|timed out|out of memory/i.test(remark) ? remark : undefined;
}

interface FetchPlan {
  readonly init?: RequestInit;
  /** Epoch ms by which the whole search must be done. */
  readonly deadline: number;
}

async function fetchJson(fetchFn: PlacesFetch, url: string, plan: FetchPlan): Promise<Result<unknown>> {
  const ms = attemptDeadlineMs({ deadline: plan.deadline, now: Date.now() });
  if (ms === 0) return Result.Err(`no time left for ${URI.from(url).hostname}`);
  const rRes = await exception2Result(() => fetchFn(url, { ...plan.init, signal: AbortSignal.timeout(ms) }));
  if (rRes.isErr()) return Result.Err(rRes);
  const res = rRes.Ok();
  if (!res.ok) return Result.Err(`${URI.from(url).hostname} answered ${res.status}`);
  return exception2Result(() => res.json() as Promise<unknown>);
}

async function geoapifySearch(args: {
  readonly fetch: PlacesFetch;
  readonly area: SearchArea;
  readonly ask: UpstreamAsk;
  readonly apiKey: string;
  readonly deadline: number;
}): Promise<Result<OsmElement[]>> {
  const out: OsmElement[] = [];
  for (const url of geoapifyUrls(args)) {
    const rBody = await fetchJson(args.fetch, url, { deadline: args.deadline });
    if (rBody.isErr()) return Result.Err(rBody);
    out.push(...geoapifyElements(rBody.Ok()));
  }
  return Result.Ok(out);
}

async function overpassSearch(args: {
  readonly fetch: PlacesFetch;
  readonly area: SearchArea;
  readonly ask: UpstreamAsk;
  readonly deadline: number;
}): Promise<Result<OsmElement[]>> {
  const body = new URLSearchParams({ data: overpassQuery(args) }).toString();
  const errors: string[] = [];
  // Mirrors in order: the first one that answers wins. Volunteer-run, so a
  // busy mirror is common and the next one is the honest retry.
  for (const mirror of OVERPASS_MIRRORS) {
    const rBody = await fetchJson(args.fetch, mirror, {
      init: { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
      deadline: args.deadline,
    });
    if (rBody.isErr()) {
      errors.push(rBody.Err().message);
      continue;
    }
    const remark = overpassRemarkError(rBody.Ok());
    if (remark !== undefined) {
      errors.push(`${URI.from(mirror).hostname}: ${remark}`);
      continue;
    }
    return Result.Ok(overpassElements(rBody.Ok()));
  }
  return Result.Err(`every Overpass mirror failed: ${errors.join("; ")}`);
}

export interface FreeSearchArgs {
  readonly fetch: PlacesFetch;
  readonly query: PlacesSearchQuery;
  /** Platform Geoapify key; unset or empty ⇒ Overpass. */
  readonly geoapifyKey?: string;
  /**
   * When the whole request must be answered by (epoch ms). A Google page that
   * falls back to free passes the deadline it started with, so the two
   * searches together stay inside one budget. Absent: SEARCH_BUDGET_MS from now.
   */
  readonly deadline?: number;
}

interface AreaAnswer {
  readonly source: "geoapify" | "overpass";
  readonly elements: readonly OsmElement[];
}

// Per isolate, keyed on the rounded area + what was asked. Only a success is
// kept (a failure is dropped so the next viewer retries), for an hour: OSM
// edits land slowly and a shared answer is the whole point of the rounding.
const areaAnswers = new KeyedResolvOnce<Result<AreaAnswer>>({ resetAfter: 60 * 60 * 1000, lru: { maxEntries: 500 } });

export function resetFreePlacesCacheForTests(): void {
  areaAnswers.reset();
}

export function areaCacheKey(args: { readonly area: SearchArea; readonly ask: UpstreamAsk; readonly source: string }): string {
  const types = [...args.ask.types].sort().join(",");
  const diets = [...args.ask.diets].sort().join(",");
  return `${args.source}|${args.area.lat},${args.area.lng},${args.area.radius}|${types}|${diets}|${(args.ask.name ?? "").toLowerCase()}`;
}

/** Free-mode search: validated query in, Google-shaped places out, nearest first. */
export async function searchPlacesFree(args: FreeSearchArgs): Promise<Result<PlacesSearchResult>> {
  const problems = placesQueryProblems(args.query);
  if (problems.length > 0) return Result.Err(problems.join("; "));
  const area = roundedSearchArea(args.query);
  const ask = upstreamAsk(args.query);
  const geoapifyKey = args.geoapifyKey?.trim() ?? "";
  const source: AreaAnswer["source"] = geoapifyKey === "" ? "overpass" : "geoapify";
  const key = areaCacheKey({ area, ask, source });
  const rAnswer = await areaAnswers
    .get(key)
    .once(async (): Promise<Result<AreaAnswer>> => {
      const deadline = args.deadline ?? Date.now() + SEARCH_BUDGET_MS;
      const rElements =
        source === "geoapify"
          ? await geoapifySearch({ fetch: args.fetch, area, ask, apiKey: geoapifyKey, deadline })
          : await overpassSearch({ fetch: args.fetch, area, ask, deadline });
      if (rElements.isErr()) return Result.Err(rElements);
      return Result.Ok({ source, elements: rElements.Ok() });
    })
    .then((r) => {
      if (r.isErr()) areaAnswers.unget(key);
      return r;
    });
  if (rAnswer.isErr()) return Result.Err(rAnswer);
  const answer = rAnswer.Ok();
  const excluded = new Set(freeTypeLists(args.query).excluded);
  const seen = new Set<string>();
  const places: PlaceWire[] = [];
  for (const el of answer.elements) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    if (!satisfiesAsk(el, ask)) continue;
    const place = toPlaceWire(el, args.query.center);
    if (place === undefined) continue;
    if ((place.distanceMeters ?? 0) > args.query.radius) continue;
    if (place.types.some((t) => excluded.has(t))) continue;
    places.push(place);
  }
  places.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  return Result.Ok({
    mode: "free",
    source: answer.source,
    attribution: FREE_PLACES_ATTRIBUTION,
    places: places.slice(0, args.query.maxResultCount ?? 20),
  });
}
