import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  CSS_MODULE_PATH,
  LICENSE_MODULE_PATH,
  WORKER_MODULE_PATH,
  readVendorSources,
  renderCssModule,
  renderLicenseModule,
  renderWorkerModule,
} from "../scripts/gen-vendor.js";

// Drift guard: the committed MapLibre stylesheet, licence and worker modules
// are what a fresh `pnpm --dir vibes.diy/google-maps-shim gen` writes for the
// installed maplibre-gl. A version bump without regenerating fails here.
describe("generated MapLibre vendor modules", () => {
  it("match a fresh render from the installed maplibre-gl", async () => {
    const src = await readVendorSources();
    expect(await readFile(CSS_MODULE_PATH, "utf-8")).toBe(renderCssModule(src));
    expect(await readFile(LICENSE_MODULE_PATH, "utf-8")).toBe(renderLicenseModule(src));
    expect(await readFile(WORKER_MODULE_PATH, "utf-8")).toBe(renderWorkerModule(src));
    expect(src.license).toContain("MapLibre contributors");
  });

  // MapLibre 6 ships its worker as a sibling file it finds from
  // import.meta.url, and a bundled, served chunk has no such sibling. The
  // shim hands MapLibre a blob: URL of this source instead, so the source
  // must stand alone: no imports, no import.meta, no sourcemap pointer.
  it("inlines a worker that runs from a blob: URL", async () => {
    const { MAPLIBRE_WORKER } = await import("../src/maplibre-worker.generated.js");
    expect(MAPLIBRE_WORKER.length).toBeGreaterThan(100_000);
    expect(MAPLIBRE_WORKER).toContain("self.worker=new");
    expect(MAPLIBRE_WORKER).not.toMatch(/^\s*import[\s{*]/m);
    expect(MAPLIBRE_WORKER).not.toContain("import.meta");
    expect(MAPLIBRE_WORKER).not.toContain("sourceMappingURL");
  });
});
