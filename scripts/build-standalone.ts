/**
 * Builds the standalone library (standalone.ts: no Vibes DIY platform) into
 * one self-contained ES module, `dist/google-maps-shim.js`, plus its sourcemap.
 * MapLibre GL, its stylesheet and its licence travel inside; nothing is
 * imported at load time. This is what the public mirror
 * (VibesDIY/google-maps-shim, scripts/export-google-maps-shim.ts) serves to
 * `<script type="module">` pages and CDN users.
 *
 *   pnpm --dir vibes.diy/google-maps-shim build:standalone
 */
import { build } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] === undefined ? resolve(root, "dist") : resolve(process.argv[2]);

await build({
  root,
  configFile: false,
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    minify: true,
    lib: { entry: resolve(root, "standalone.ts"), formats: ["es"], fileName: () => "google-maps-shim.js" },
  },
});
console.log(`built ${resolve(outDir, "google-maps-shim.js")}`);
