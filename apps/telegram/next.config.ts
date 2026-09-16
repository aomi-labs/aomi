import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const appNodeModules = path.join(appRoot, "node_modules");

// Para consumes React Query through a peer dependency. Pin both sides to the
// app copy so the provider and Para hooks share the same runtime context.

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: ["@aomi-labs/client"],
  turbopack: {
    resolveAlias: {
      "@aomi-labs/client": "../../packages/client/src/index.ts",
      "@getpara/core-sdk": "./node_modules/@getpara/core-sdk",
      "@getpara/user-management-client":
        "./node_modules/@getpara/user-management-client",
      "@getpara/web-sdk": "./node_modules/@getpara/web-sdk",
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
      "@getpara/core-sdk": path.join(appNodeModules, "@getpara/core-sdk"),
      "@getpara/user-management-client": path.join(
        appNodeModules,
        "@getpara/user-management-client",
      ),
      "@getpara/web-sdk": path.join(appNodeModules, "@getpara/web-sdk"),
      "@tanstack/react-query": path.join(
        appNodeModules,
        "@tanstack/react-query",
      ),
    };
    return config;
  },
};

export default nextConfig;
