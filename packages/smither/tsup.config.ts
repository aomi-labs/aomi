import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
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
    // @aomi-labs/internal is a private workspace package; bundle it.
    noExternal: ["@aomi-labs/internal"],
    tsconfig: "tsconfig.json",
  },
  {
    entry: ["src/cli.tsx"],
    outDir: "dist",
    format: ["esm"],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    noExternal: ["@aomi-labs/internal"],
    // Smithers persists runs via bun:sqlite, so the CLI prefers Bun.
    banner: { js: "#!/usr/bin/env bun" },
    tsconfig: "tsconfig.json",
  },
]);
