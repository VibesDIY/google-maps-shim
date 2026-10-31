import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true, // vitest 5: per project, not inherited from the root config
    name: "google-maps-shim",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
