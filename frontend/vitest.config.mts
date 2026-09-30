import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Only the pure logic is tested: cart totals, catalog filtering and the API
 * adapters. That is where silent breakage would hide, and none of it needs a
 * DOM or a running Next server.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
