// Google's own Maps JavaScript API, loaded the way Google's dynamic library
// import bootstrap does it (developers.google.com/maps/documentation/javascript/load-maps-js-api):
// one <script> for maps/api/js with the key and options as query parameters and
// `callback=google.maps.__ib__`. When the script runs it defines Google's real
// `google.maps.importLibrary` and calls the callback. Written out here rather
// than taken from esm.sh so Google mode depends on Google alone. No runtime
// imports: the served shim imports only the vibe runtime (the emitted-bundle test).

export const GOOGLE_MAPS_JS_URL = "https://maps.googleapis.com/maps/api/js";
const CALLBACK = "__ib__";

/** What the loaded API gives us: Google's real `importLibrary`. */
export interface GoogleMapsApi {
  importLibrary(name: string): Promise<object>;
}

export interface GoogleBootstrapDeps {
  readonly document: Document;
  /** Where Google publishes `google.maps`; `globalThis` in a vibe. */
  readonly global: Record<string, unknown>;
}

/** Google's parameter names are snake_case (`map_ids`, `auth_referrer_policy`); the loader options are camelCase. */
function paramName(option: string): string {
  return option.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Load the Maps JavaScript API once. `params` carries `key`, `v` and any of the
 * app's own loader options (`language`, `region`, …). Resolves with Google's
 * real `importLibrary` once the script has called back; rejects when the script
 * cannot load.
 */
export function loadGoogleMapsApi(deps: GoogleBootstrapDeps, params: Readonly<Record<string, string>>): Promise<GoogleMapsApi> {
  return new Promise<GoogleMapsApi>((resolve, reject) => {
    const google = (deps.global.google ?? {}) as Record<string, unknown>;
    const maps = (google.maps ?? {}) as Record<string, unknown>;
    google.maps = maps;
    deps.global.google = google;
    maps[CALLBACK] = () => {
      const real = maps.importLibrary;
      if (typeof real !== "function") {
        reject(new Error("The Google Maps JavaScript API loaded without importLibrary"));
        return;
      }
      const importLibrary = real as (name: string) => Promise<object>;
      resolve({ importLibrary: (name) => importLibrary(name) });
    };
    const query = new URLSearchParams();
    for (const [option, value] of Object.entries(params)) query.set(paramName(option), value);
    query.set("callback", `google.maps.${CALLBACK}`);
    const script = deps.document.createElement("script");
    script.src = `${GOOGLE_MAPS_JS_URL}?${query.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error("The Google Maps JavaScript API could not load"));
    deps.document.head.appendChild(script);
  });
}
