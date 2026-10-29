import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/lifecycle.ts",
    "src/schemas/index.ts",
    "src/launch/index.ts",
  ],
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: {
    compilerOptions: {
      incremental: false,
    },
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.json",
});
