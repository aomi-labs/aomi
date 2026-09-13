import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const appNodeModules = path.join(appRoot, "node_modules");

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  // `@aomi-labs/widget-lib` is consumed for its Privy-free UI primitives and
  // design tokens only. Its wallet providers pin Privy v2 while this app runs
  // v3, so nothing under `providers/*` or `lib/wallet-kit` may ever be imported
  // here — see the bundle check in the package's `check` script.
  transpilePackages: [
    "@aomi-labs/client",
    "@aomi-labs/react",
    "@aomi-labs/widget-lib",
  ],
  turbopack: {
    resolveAlias: {
      "@aomi-labs/client": "../../packages/client/src/index.ts",
      // Privy consumes React Query through a peer dependency. Pin both sides to
      // the app copy so the provider and Privy's hooks share one context.
      "@tanstack/react-query": "./node_modules/@tanstack/react-query",
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@aomi-labs/client": path.join(
        workspaceRoot,
        "packages/client/src/index.ts",
      ),
      "@tanstack/react-query": path.join(
        appNodeModules,
        "@tanstack/react-query",
      ),
    };
    return config;
  },
};

export default nextConfig;
