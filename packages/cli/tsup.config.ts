import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  outDir: "dist",
  format: ["esm"],
  dts: false,
  splitting: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
