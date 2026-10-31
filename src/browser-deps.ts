import { Map as MapLibreMap, Marker as MapLibreMarker, NavigationControl, Popup } from "maplibre-gl";
import type { GoogleMapsShimDeps, RealLoaderModule } from "./loader.js";
import { createDetachWatch, type ObserverCtor } from "./detach-watch.js";
import { MAPLIBRE_CSS } from "./maplibre-css.generated.js";
import { loadGoogleMapsApi } from "./google-bootstrap.js";
import type { MapLibrePort } from "./port.js";

// The browser half every entry shares: MapLibre GL (bundled, same origin, no
// CDN), its stylesheet, the detach watch, Google's bootstrap, and Google's
// real loader for an app that brings its own real key. An entry adds how the
// page's mode is decided and where place searches go.

const maplibre: MapLibrePort = {
  createMap: (opts) => new MapLibreMap(opts),
  createMarker: (element) => new MapLibreMarker({ element, anchor: "bottom" }),
  createPopup: (opts) => new Popup({ closeButton: true, maxWidth: opts.maxWidth, offset: opts.offset }),
  createNavigationControl: () => new NavigationControl({ showCompass: false }),
};

// Google's real loader: the same unpinned esm.sh URL a vibe's import map gave
// this specifier before the alias existed, so apps with their own real key
// load exactly what they always did. A runtime specifier keeps it out of the
// bundle; it is fetched only on that path.
const REAL_LOADER_URL = "https://esm.sh/@googlemaps/js-api-loader?external=react,react-dom";

export type BrowserDeps = Omit<GoogleMapsShimDeps, "search" | "mapsMode" | "reportMapLoad">;

export function browserDeps(): BrowserDeps {
  return {
    loadRealLoader: () => import(/* @vite-ignore */ REAL_LOADER_URL) as Promise<RealLoaderModule>,
    maplibre,
    css: MAPLIBRE_CSS,
    document: globalThis.document,
    prefersDark: () => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true,
    onDetached: createDetachWatch({
      document: globalThis.document,
      MutationObserver: globalThis.MutationObserver as ObserverCtor | undefined,
    }),
    loadGoogleMaps: (params) =>
      loadGoogleMapsApi({ document: globalThis.document, global: globalThis as unknown as Record<string, unknown> }, params),
    global: globalThis as unknown as Record<string, unknown>,
  };
}
