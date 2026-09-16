import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "aomi-widget": "src/components/aomi-widget.tsx",
    "providers/para": "src/lib/wallet-kit/providers/para/index.ts",
    "providers/privy": "src/lib/wallet-kit/providers/privy/index.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: false,
  treeshake: false,
  banner: { js: '"use client";' },
  tsconfig: "tsconfig.json",
});
