import { defineConfig } from "tsup";
import { entries, deprecated } from "./package-entries.json";

export default defineConfig({
  entry: { ...entries, ...deprecated },
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  dts: false,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  banner: { js: '"use client";' },
  tsconfig: "tsconfig.json",
});
