export declare const FREE_MAP_SUBSET = "maps (Map, InfoWindow, LatLng, LatLngBounds, event), marker (AdvancedMarkerElement, PinElement), core, and places (Place.searchNearby, Place.searchByText)";
export declare function notInFreeMap(what: string): Error;
/** A non-enumerable getter that throws `notInFreeMap(name)`, for a Google member this subset leaves out. */
export declare function defineUnavailable(target: object, members: readonly string[], prefix: string): void;
