import type { Result } from "@adviser/cement";
import { LatLng, LatLngBounds, event } from "./core.js";
import { defineUnavailable, notInFreeMap } from "./errors.js";
import { createFreeMap, type FreeMapDeps } from "./free-map.js";
import { createPlacesLibrary, type MapMode, type PlacesSearch } from "./places.js";
import type { GoogleMapsApi } from "./google-bootstrap.js";

// The `@googlemaps/js-api-loader` surface, both generations:
//   v2: setOptions({ key }) then importLibrary("maps" | "marker" | "places" | "core")
//   v1: new Loader({ apiKey }).importLibrary(name) / .load()
// With no key, or a placeholder, the platform holds the keys and picks the
// mode, ONCE per page, before the first `importLibrary` resolves (#8104):
//   - google: Google's real Maps JavaScript API with the platform's browser
//     key; maps/marker/core are Google's own libraries, and places is OUR
//     Place class, so every Places call goes through the metered platform
//     search (the browser key cannot call Places anyway).
//   - free: the MapLibre subset on OpenFreeMap, places from OpenStreetMap.
// `globalThis.google.maps` carries the same objects, as Google's bootstrap
// does. With the app's own real key, every call goes to Google's real loader
// instead (`isRealGoogleKey`): their key, their bill.

/** The shape of a real Google Maps API key. "YOUR_API_KEY", "" and the like are not one. */
export const REAL_GOOGLE_KEY = /^AIza[0-9A-Za-z_-]{35}$/;

export function isRealGoogleKey(key: unknown): boolean {
  return typeof key === "string" && REAL_GOOGLE_KEY.test(key);
}

export interface RealLoaderInstance {
  importLibrary(name: string): Promise<object>;
  load(): Promise<unknown>;
}

/** The parts of Google's own `@googlemaps/js-api-loader` the passthrough calls. */
export interface RealLoaderModule {
  setOptions(options: Record<string, unknown>): void;
  importLibrary(name: string): Promise<object>;
  readonly Loader: new (options: Record<string, unknown>) => RealLoaderInstance;
}

/** The platform's answer for this page (vibe-types VibePlacesMapModeDecision). */
export type MapModeDecision =
  | { readonly mode: "google"; readonly browserKey: string; readonly mapId: string }
  | { readonly mode: "free"; readonly reason: string };

export interface GoogleMapsShimDeps extends FreeMapDeps {
  readonly search: PlacesSearch;
  /** Where `google.maps` is published; `globalThis` in a vibe. */
  readonly global: Record<string, unknown>;
  /** Google's real loader module, loaded only for an app that brings its own real key. */
  readonly loadRealLoader: () => Promise<RealLoaderModule>;
  /** Ask the platform for this page's map mode. Called once per page; bills nothing. */
  readonly mapsMode: () => Promise<Result<MapModeDecision>>;
  /** Tell the platform one Google map was constructed: Google bills per map, so this is what is metered. */
  readonly reportMapLoad: () => Promise<unknown>;
  /** Load Google's Maps JavaScript API with these parameters (`key`, `v`, …). Called at most once. */
  readonly loadGoogleMaps: (params: Readonly<Record<string, string>>) => Promise<GoogleMapsApi>;
}

/** The page's settled mode: Google's real API, or the free map and why. */
type PageMode =
  | { readonly mode: "google"; readonly api: GoogleMapsApi; readonly mapId: string }
  | { readonly mode: "free"; readonly reason: string };

/** Loader options passed on to Google's script in Google mode (the key is the platform's). */
const GOOGLE_PASSTHROUGH_OPTIONS = ["v", "version", "language", "region", "authReferrerPolicy", "channel", "solutionChannel"];

/** The credit OpenStreetMap places need when they are shown on a Google map. */
export const OSM_PLACES_CREDIT = "Places © OpenStreetMap contributors";

export const SUPPORTED_LIBRARIES = ["core", "maps", "marker", "places"] as const;

/** maps-library classes the free map leaves out; reading one throws by name. */
const UNAVAILABLE_MAPS_CLASSES = [
  "Polyline",
  "Polygon",
  "Circle",
  "Rectangle",
  "Data",
  "OverlayView",
  "StreetViewPanorama",
  "TrafficLayer",
  "TransitLayer",
  "BicyclingLayer",
  "KmlLayer",
  "ImageMapType",
  "StyledMapType",
  "Map3DElement",
];

/** Members of other Google libraries an app may reach for on `google.maps`. */
const UNAVAILABLE_GLOBAL_MEMBERS = [
  "DirectionsService",
  "DirectionsRenderer",
  "DistanceMatrixService",
  "Geocoder",
  "ElevationService",
  "MaxZoomService",
  "geometry",
  "drawing",
  "visualization",
  "journeySharing",
];

export function createGoogleMapsShim(deps: GoogleMapsShimDeps) {
  const free = createFreeMap(deps);
  // Read only after the page's mode has settled (every importLibrary awaits it first).
  let settledMode: MapMode = "free";
  const placesLib = createPlacesLibrary({
    search: deps.search,
    mapMode: () => settledMode,
    onFreePlacesOnGoogle: () => showOsmCredit(),
  });

  const core = { LatLng, LatLngBounds, event };
  const maps = {
    Map: free.Map,
    InfoWindow: free.InfoWindow,
    Marker: free.Marker,
    LatLng,
    LatLngBounds,
    event,
  };
  const marker = { AdvancedMarkerElement: free.AdvancedMarkerElement, PinElement: free.PinElement };
  defineUnavailable(maps, UNAVAILABLE_MAPS_CLASSES, "maps.");
  const libraries: Readonly<Record<string, object>> = { core, maps, marker, places: placesLib };

  function publishGlobal(): Record<string, unknown> {
    const google = (deps.global.google ?? {}) as Record<string, unknown>;
    const ns = (google.maps ?? {}) as Record<string, unknown>;
    Object.assign(ns, core, maps, { marker, places: placesLib, importLibrary });
    defineUnavailable(
      ns,
      [...UNAVAILABLE_MAPS_CLASSES, ...UNAVAILABLE_GLOBAL_MEMBERS].filter(
        (name) => !Object.prototype.hasOwnProperty.call(ns, name)
      ),
      "google.maps."
    );
    google.maps = ns;
    deps.global.google = google;
    return ns;
  }

  async function freeImportLibrary(name: string): Promise<object> {
    const lib = libraries[name];
    if (lib === undefined) throw notInFreeMap(`importLibrary("${name}")`);
    publishGlobal();
    return lib;
  }

  // ── Google mode: the real Maps JavaScript API, our places ──────────────
  /** Google's libraries as handed to the app, built once each. */
  const googleLibraries = new Map<string, Promise<object>>();

  // OpenStreetMap places shown on a Google page carry OSM's licence, which asks
  // for a visible credit. Once any have been handed to the app, every Google
  // map on the page (now or later) shows one, whatever fields were requested.
  const googleMaps = new Set<object>();
  const credited = new WeakSet<object>();
  let osmCreditNeeded = false;

  function creditOn(map: object): void {
    if (credited.has(map)) return;
    credited.add(map);
    const credit = deps.document.createElement("div");
    credit.className = "vibes-osm-places-credit";
    const look = "padding:0 4px;font:11px/1.5 system-ui,sans-serif;background:rgba(255,255,255,.75);color:#333;border-radius:3px";
    credit.textContent = OSM_PLACES_CREDIT;
    // Google's controls API places it beside Google's own credits; a map without one gets it in its box.
    const ns = (deps.global.google as { maps?: { ControlPosition?: Record<string, unknown> } } | undefined)?.maps;
    const position = ns?.ControlPosition?.BOTTOM_LEFT;
    const controls = (map as { controls?: Record<string, { push(el: unknown): unknown } | undefined> }).controls;
    const slot = position === undefined ? undefined : controls?.[String(position)];
    if (slot !== undefined) {
      credit.setAttribute("style", "margin:0 0 2px 4px;" + look);
      slot.push(credit);
      return;
    }
    credit.setAttribute("style", "position:absolute;left:4px;bottom:20px;z-index:2;" + look);
    (map as { getDiv?: () => { appendChild(el: unknown): unknown } }).getDiv?.().appendChild(credit);
  }

  function showOsmCredit(): void {
    osmCreditNeeded = true;
    googleMaps.forEach(creditOn);
  }

  /** Every Google map gets the platform's Map ID: Advanced Markers need one, and an app's own Map ID belongs to another project. */
  function withPlatformMapId(lib: object, mapId: string): object {
    const RealMap = (lib as { readonly Map?: unknown }).Map;
    if (typeof RealMap !== "function") return lib;
    const Base = RealMap as new (el: unknown, opts?: Record<string, unknown>) => object;
    class Map extends Base {
      constructor(el: unknown, opts: Record<string, unknown> = {}) {
        super(el, { colorScheme: "FOLLOW_SYSTEM", ...opts, mapId });
        // One constructed map is one Dynamic Maps load: reported once, here, and never for a page
        // that only imported places or whose script failed. A failed report is not the app's problem.
        deps.reportMapLoad().then(
          () => undefined,
          () => undefined
        );
        googleMaps.add(this);
        if (osmCreditNeeded) creditOn(this);
      }
    }
    // The library's own members stay readable through the prototype; only Map is ours. Google's
    // libraries are frozen, so an inherited read-only Map would reject plain assignment: define it.
    return Object.defineProperty(Object.create(lib) as object, "Map", {
      value: Map,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  function googleImportLibrary(page: Extract<PageMode, { mode: "google" }>, name: string): Promise<object> {
    if (name === "places") return Promise.resolve(placesLib);
    const known = googleLibraries.get(name);
    if (known !== undefined) return known;
    const loaded = page.api.importLibrary(name).then((lib) => {
      if (name !== "maps") return lib;
      const wrapped = withPlatformMapId(lib, page.mapId);
      const ns = (deps.global.google as { maps: Record<string, unknown> }).maps;
      // google.maps.Map may be read-only too; when Google locked it, the app still gets the wrapper from importLibrary.
      Reflect.defineProperty(ns, "Map", {
        value: (wrapped as { readonly Map: unknown }).Map,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return wrapped;
    });
    googleLibraries.set(name, loaded);
    return loaded;
  }

  /** After Google's script has run: `google.maps.places` and `google.maps.importLibrary("places")` are ours too. */
  function publishGoogleGlobal(page: Extract<PageMode, { mode: "google" }>): void {
    const ns = (deps.global.google as { maps: Record<string, unknown> }).maps;
    ns.places = placesLib;
    ns.importLibrary = (name: string) => googleImportLibrary(page, name);
  }

  async function settlePage(): Promise<PageMode> {
    const rMode = await deps.mapsMode();
    if (rMode.isErr()) return { mode: "free", reason: "mode-unavailable" };
    const decision = rMode.Ok();
    if (decision.mode === "free") return decision;
    const params: Record<string, string> = { v: "weekly", loading: "async" };
    for (const option of GOOGLE_PASSTHROUGH_OPTIONS) {
      const value = appOptions[option];
      if (typeof value === "string" && value !== "") params[option === "version" ? "v" : option] = value;
    }
    params.key = decision.browserKey;
    // Nothing of Google's has reached the app yet, so if the script fails the whole page can still be free.
    return deps.loadGoogleMaps(params).then(
      (api): PageMode => {
        const page = { mode: "google", api, mapId: decision.mapId } as const;
        publishGoogleGlobal(page);
        return page;
      },
      (): PageMode => ({ mode: "free", reason: "google-load-failed" })
    );
  }

  let pageMode: Promise<PageMode> | undefined;

  async function platformImportLibrary(name: string): Promise<object> {
    pageMode ??= settlePage().then((page) => {
      settledMode = page.mode;
      return page;
    });
    const page = await pageMode;
    if (page.mode === "free") return freeImportLibrary(name);
    return googleImportLibrary(page, name);
  }

  // ── The app's own Google key: Google's real loader, untouched ──────────
  // An app that brings a real key (written before the platform map existed, or
  // by someone who wants their own Google account) keeps getting Google's
  // loader, exactly as when this specifier fell through to esm.sh. Their key,
  // their bill. A placeholder or missing key takes the platform path.
  let realModule: Promise<RealLoaderModule> | undefined;
  const loadReal = (): Promise<RealLoaderModule> => (realModule ??= deps.loadRealLoader());

  let appOptions: Record<string, unknown> = {};
  let realReady: Promise<RealLoaderModule> | undefined;

  async function importLibrary(name: string): Promise<object> {
    if (!isRealGoogleKey(appOptions.key ?? appOptions.apiKey)) return platformImportLibrary(name);
    realReady ??= loadReal().then((real) => {
      real.setOptions(appOptions);
      return real;
    });
    const real = await realReady;
    return real.importLibrary(name);
  }

  /** v2 `setOptions`. A real `key` hands the app to Google's own loader; otherwise the platform supplies keys and mode. */
  function setOptions(options: Record<string, unknown>): void {
    appOptions = { ...appOptions, ...options };
  }

  /** v1 `Loader` class. */
  class Loader {
    readonly options: Record<string, unknown>;
    readonly #real: Promise<RealLoaderInstance> | undefined;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      this.#real = isRealGoogleKey(options.apiKey ?? options.key) ? loadReal().then((real) => new real.Loader(options)) : undefined;
    }

    async importLibrary(name: string): Promise<object> {
      if (this.#real !== undefined) return (await this.#real).importLibrary(name);
      return platformImportLibrary(name);
    }

    /** Resolves with `google` once maps is ready, like the v1 loader. */
    async load(): Promise<unknown> {
      if (this.#real !== undefined) return (await this.#real).load();
      const wanted = Array.isArray(this.options.libraries) ? (this.options.libraries as string[]) : [];
      // maps, not just core: on a Google page that is what installs the Map-ID wrapper on google.maps.Map.
      await platformImportLibrary("maps");
      for (const name of wanted) await platformImportLibrary(name);
      if (settledMode === "free") publishGlobal();
      return deps.global.google;
    }

    loadPromise(): Promise<unknown> {
      return this.load();
    }

    loadCallback(callback: (err?: Error) => void): void {
      this.load().then(
        () => callback(),
        (err: Error) => callback(err)
      );
    }
  }

  return { setOptions, importLibrary, Loader, libraries };
}
