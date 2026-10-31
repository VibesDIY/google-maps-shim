import { describe, expect, it } from "vitest";
import { harness } from "./fakes.js";
import { isRealGoogleKey } from "../src/loader.js";

// An app that brings its own real Google key keeps Google's real loader, as it
// had before the platform map existed (their key, their bill). A placeholder or
// missing key takes the platform path.

const REAL_KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuv";

describe("isRealGoogleKey", () => {
  it("accepts Google's key shape and nothing else", () => {
    expect(REAL_KEY).toHaveLength(39);
    expect(isRealGoogleKey(REAL_KEY)).toBe(true);
    for (const placeholder of ["", "YOUR_API_KEY", "AIza...", "AIzaYOUR_KEY_HERE", `${REAL_KEY}x`, undefined, null, 42]) {
      expect(isRealGoogleKey(placeholder)).toBe(false);
    }
  });
});

describe("v2 setOptions + importLibrary", () => {
  it("passes a real key straight through to Google's loader, options untouched", async () => {
    const h = harness();
    h.shim.setOptions({ key: REAL_KEY, v: "weekly" });
    const maps = await h.shim.importLibrary("maps");
    await h.shim.importLibrary("routes");
    expect(maps).toEqual({ real: "maps" });
    expect(h.real.calls).toEqual([
      ["setOptions", { key: REAL_KEY, v: "weekly" }],
      ["importLibrary", "maps"],
      ["importLibrary", "routes"],
    ]);
    expect(h.real.loads).toBe(1);
    expect(h.ml.maps).toHaveLength(0);
    expect(h.global.google).toBeUndefined();
  });

  it("takes the platform path for a placeholder or missing key, and never loads Google's loader", async () => {
    for (const options of [{ key: "YOUR_API_KEY" }, { key: "" }, { v: "weekly" }]) {
      const h = harness();
      h.shim.setOptions(options);
      const maps = (await h.shim.importLibrary("maps")) as Record<string, unknown>;
      expect(typeof maps.Map).toBe("function");
      expect(h.real.loads).toBe(0);
    }
    const bare = harness();
    expect(await bare.shim.importLibrary("marker")).toHaveProperty("AdvancedMarkerElement");
    expect(bare.real.loads).toBe(0);
  });
});

describe("v1 Loader", () => {
  it("builds Google's own Loader for a real apiKey", async () => {
    const h = harness();
    const loader = new h.shim.Loader({ apiKey: REAL_KEY, version: "weekly" });
    expect(await loader.importLibrary("places")).toEqual({ real: "places" });
    expect(await loader.load()).toEqual({ maps: { real: true } });
    expect(h.real.calls).toEqual([
      ["new Loader", { apiKey: REAL_KEY, version: "weekly" }],
      ["Loader.importLibrary", "places"],
      ["Loader.load"],
    ]);
  });

  it("serves the platform map for a placeholder apiKey", async () => {
    const h = harness();
    const loader = new h.shim.Loader({ apiKey: "YOUR_API_KEY" });
    const maps = (await loader.importLibrary("maps")) as Record<string, unknown>;
    expect(typeof maps.Map).toBe("function");
    expect(h.real.loads).toBe(0);
  });
});
