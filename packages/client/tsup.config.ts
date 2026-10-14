import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/browser-auth.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: { compilerOptions: { incremental: false } },
  splitting: false,
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.json",
});
