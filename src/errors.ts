// Every gap in the free map is said out loud. A Google Maps call this subset
// does not cover throws an Error naming it, so the app's own error path (or the
// console) shows what to change, instead of a map that quietly does less.

export const FREE_MAP_SUBSET =
  "maps (Map, InfoWindow, LatLng, LatLngBounds, event), marker (AdvancedMarkerElement, PinElement), core, and places (Place.searchNearby, Place.searchByText)";

export function notInFreeMap(what: string): Error {
  return new Error(`${what} is not available in the free map. The free map covers ${FREE_MAP_SUBSET}.`);
}

/** A non-enumerable getter that throws `notInFreeMap(name)`, for a Google member this subset leaves out. */
export function defineUnavailable(target: object, members: readonly string[], prefix: string): void {
  for (const member of members) {
    Object.defineProperty(target, member, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw notInFreeMap(`${prefix}${member}`);
      },
    });
  }
}
