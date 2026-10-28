import { defineConfig, type Options } from "tsup";

const shared = {
  outDir: "dist",
  format: ["esm", "cjs"],
  dts: { compilerOptions: { incremental: false } },
  splitting: false,
  sourcemap: true,
  tsconfig: "tsconfig.json",
} satisfies Options;

// The trace subpath builds on its own, so its declarations never pull the
// root's into a shared chunk. `pnpm build` clears dist first.
export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts", "browser-auth": "src/browser-auth.ts" },
  },
  { ...shared, entry: { trace: "src/trace/index.ts" } },
]);
