import { platformMapsMode, searchPlatformPlaces } from "@vibes.diy/vibe-runtime";
import { createGoogleMapsShim } from "./src/loader.js";
import { browserDeps } from "./src/browser-deps.js";

// `@googlemaps/js-api-loader`, as a vibe sees it (#8104). The import map points
// that specifier here, so an app writes Google's own loader code:
//
//   import { setOptions, importLibrary } from "@googlemaps/js-api-loader";
//   const { Map } = await importLibrary("maps");
//
// The platform picks the page's mode once, at the first importLibrary: Google
// mode loads Google's real Maps JavaScript API with the platform's browser key;
// free mode is MapLibre GL (bundled into this module, same origin, no CDN) on
// OpenFreeMap tiles. Places always come through the platform search. See
// README.md for both modes and what throws in free mode. Outside vibes.diy,
// `standalone.ts` is the same library with no platform behind it.

const shim = createGoogleMapsShim({
  ...browserDeps(),
  search: (query, mapMode) => searchPlatformPlaces(query, { mapMode }),
  mapsMode: () => platformMapsMode(),
  reportMapLoad: () => platformMapsMode({ report: "map-load" }),
});

export const setOptions = shim.setOptions;
export const importLibrary = shim.importLibrary;
export const Loader = shim.Loader;
export { licenses } from "./src/licenses.generated.js";
export { FREE_MAP_ATTRIBUTION } from "./src/free-map.js";
