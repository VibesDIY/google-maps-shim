/// <reference types="google.maps" />
import type { MapMode, PlacesQueryWire, PlacesResultWire, PlaceWire } from "./types/places-wire.js";

export type { MapMode, PlacesQueryWire, PlacesResultWire, PlaceWire };

/** Google's loader options. A real key (AIza…) runs on Google; no key or a placeholder runs the free map. */
export interface LoaderOptions {
  key?: string;
  apiKey?: string;
  v?: string;
  version?: string;
  language?: string;
  region?: string;
  libraries?: string[];
  [option: string]: unknown;
}

export declare function setOptions(options: LoaderOptions): void;
export declare function importLibrary(name: "core"): Promise<google.maps.CoreLibrary>;
export declare function importLibrary(name: "maps"): Promise<google.maps.MapsLibrary>;
export declare function importLibrary(name: "marker"): Promise<google.maps.MarkerLibrary>;
export declare function importLibrary(name: "places"): Promise<google.maps.PlacesLibrary>;
export declare function importLibrary(name: string): Promise<unknown>;

/** The v1 loader class: `new Loader({ apiKey }).importLibrary(name)` or `.load()`. */
export declare class Loader {
  constructor(options: LoaderOptions);
  importLibrary: typeof importLibrary;
  load(): Promise<typeof google>;
}

/** A page's own place search: resolve to Google-shaped places, or reject with why. */
export type FreeMapsSearch = (query: PlacesQueryWire, mapMode: MapMode) => Promise<PlacesResultWire>;

export interface FreeMapsOptions {
  /** A Geoapify key (browser-safe, free tier): steadier place answers than the volunteer Overpass mirrors. */
  readonly geoapifyKey?: string;
  /** Answer place searches yourself (your own server, a cache, test data). Overrides geoapifyKey. */
  readonly search?: FreeMapsSearch;
  /** The fetch the built-in OpenStreetMap search uses. Defaults to globalThis.fetch. */
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Set where free-map place searches go. */
export declare function configureFreeMaps(options: FreeMapsOptions): void;
/** Whether a string is shaped like a real Google Maps key. */
export declare function isRealGoogleKey(key: unknown): boolean;
/** Google place type → the OpenStreetMap tags the free search finds it by. */
export declare const FREE_PLACE_TYPES: Readonly<Record<string, unknown>>;
/** MapLibre GL JS's licence, carried in the bundle. */
export declare const licenses: string;
/** The credit line the free map shows. */
export declare const FREE_MAP_ATTRIBUTION: string;
