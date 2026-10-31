import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  CSS_MODULE_PATH,
  LICENSE_MODULE_PATH,
  readVendorSources,
  renderCssModule,
  renderLicenseModule,
} from "../scripts/gen-vendor.js";

// Drift guard: the committed MapLibre stylesheet and licence modules are what
// a fresh `pnpm --dir vibes.diy/google-maps-shim gen` writes for the installed
// maplibre-gl. A version bump without regenerating fails here.
describe("generated MapLibre vendor modules", () => {
  it("match a fresh render from the installed maplibre-gl", async () => {
    const src = await readVendorSources();
    expect(await readFile(CSS_MODULE_PATH, "utf-8")).toBe(renderCssModule(src));
    expect(await readFile(LICENSE_MODULE_PATH, "utf-8")).toBe(renderLicenseModule(src));
    expect(src.license).toContain("MapLibre contributors");
  });
});
