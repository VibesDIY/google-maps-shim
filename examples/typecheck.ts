import { configureFreeMaps, importLibrary, setOptions, type PlaceWire } from "@vibes.diy/google-maps-shim";

export async function cafes(el: HTMLElement): Promise<readonly PlaceWire[]> {
  setOptions({ v: "weekly" });
  const { Map } = await importLibrary("maps");
  const { AdvancedMarkerElement } = await importLibrary("marker");
  const { Place } = await importLibrary("places");
  const center = { lat: 45.5197, lng: -122.6786 };
  const map = new Map(el, { center, zoom: 15, mapId: "DEMO_MAP_ID" });
  const { places } = await Place.searchNearby({
    fields: ["displayName", "location"],
    locationRestriction: { center, radius: 1200 },
    includedPrimaryTypes: ["cafe"],
  });
  for (const p of places) new AdvancedMarkerElement({ map, position: p.location, title: p.displayName });
  const fixed: PlaceWire[] = [{ id: "osm:node/1", displayName: "Test", location: center, types: ["cafe"] }];
  configureFreeMaps({ search: async () => ({ mode: "free", source: "test", attribution: "© OpenStreetMap contributors", places: fixed }) });
  return fixed;
}
