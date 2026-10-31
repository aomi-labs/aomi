import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "node20",
  dts: false,
  splitting: false,
  clean: true,
  // Private workspace code ships inside the bin; published packages stay dependencies.
  noExternal: ["@aomi-labs/internal"],
  banner: { js: "#!/usr/bin/env node" },
});
