import { defineConfig } from "vitest/config";

// Explicit opt-in lane: frozen contracts remain unconditional workspace tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/client/src/backend-openapi.live.ts"],
  },
});
