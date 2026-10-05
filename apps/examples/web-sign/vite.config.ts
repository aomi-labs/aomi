import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Inside this monorepo, compile the SDK straight from source so the example
    // runs without building packages/client first. In your own project, delete
    // this alias and install `@aomi-labs/client` from npm.
    alias: {
      "@aomi-labs/client": fileURLToPath(
        new URL("../../../packages/client/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { port: 5174, strictPort: true },
});
