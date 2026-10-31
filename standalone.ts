import { exception2Result, Result } from "@adviser/cement";
import { createGoogleMapsShim } from "./src/loader.js";
import { browserDeps } from "./src/browser-deps.js";
import { searchPlacesFree, type PlacesFetch } from "./src/osm-places.js";
import type { MapMode, PlacesQueryWire, PlacesResultWire, PlacesSearch } from "./src/places.js";

// The google-maps-shim with no Vibes DIY platform behind it: a drop-in for
// `@googlemaps/js-api-loader` on any web page.
//
//   import { setOptions, importLibrary } from "@vibes.diy/google-maps-shim/standalone";
//   setOptions({ key: GOOGLE_KEY_OR_NOTHING });
//   const { Map } = await importLibrary("maps");
//
// With a real Google key, every call goes to Google's real loader: your key,
// your bill, your code unchanged. With no key (or a placeholder), you get the
// free map: MapLibre GL on OpenFreeMap tiles, and `Place.searchNearby` /
// `searchByText` answered from OpenStreetMap, straight from the browser (the
// public Overpass mirrors, or Geoapify with `configureFreeMaps({ geoapifyKey })`).

/** A page's own place search: resolve to Google-shaped places, or reject with why. */
export type FreeMapsSearch = (query: PlacesQueryWire, mapMode: MapMode) => Promise<PlacesResultWire>;

export interface FreeMapsOptions {
  /** A Geoapify key (browser-safe, free tier): steadier place answers than the volunteer Overpass mirrors. */
  readonly geoapifyKey?: string;
  /** Answer place searches yourself (your own server, a cache, test data). Overrides `geoapifyKey`. */
  readonly search?: FreeMapsSearch;
  /** The fetch the built-in OpenStreetMap search uses. Defaults to `globalThis.fetch`. */
  readonly fetch?: PlacesFetch;
}

let options: FreeMapsOptions = {};

/** Set where free-mode place searches go. Call before the first search; later calls apply to later searches. */
export function configureFreeMaps(next: FreeMapsOptions): void {
  options = { ...next };
}

const search: PlacesSearch = (query, mapMode) => {
  const own = options.search;
  if (own !== undefined) return exception2Result(() => own(query, mapMode));
  const fetchFn: PlacesFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return searchPlacesFree({ fetch: fetchFn, query, geoapifyKey: options.geoapifyKey });
};

const shim = createGoogleMapsShim({
  ...browserDeps(),
  search,
  // No platform, no platform key: without your own real key the page is always free.
  mapsMode: async () => Result.Ok({ mode: "free", reason: "standalone" }),
  reportMapLoad: async () => undefined,
});

export const setOptions = shim.setOptions;
export const importLibrary = shim.importLibrary;
export const Loader = shim.Loader;
export { isRealGoogleKey } from "./src/loader.js";
export { FREE_PLACE_TYPES } from "./src/osm-places.js";
export { licenses } from "./src/licenses.generated.js";
export { FREE_MAP_ATTRIBUTION } from "./src/free-map.js";
export type { PlacesQueryWire, PlacesResultWire, PlaceWire, MapMode } from "./src/places.js";
