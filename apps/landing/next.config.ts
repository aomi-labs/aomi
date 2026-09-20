import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import path from "node:path";

const withMDX = createMDX();

// Absolute paths for webpack aliases
const landingNodeModules = path.resolve(__dirname, "node_modules");
const clientPkgSrc = path.resolve(__dirname, "../../packages/client/src");
const reactPkgSrc = path.resolve(__dirname, "../../packages/react/src");
const widgetSrc = path.resolve(__dirname, "../shadcn-registry/src");
const docsSrc = path.resolve(__dirname);
const landingSrc = path.resolve(__dirname, "src");
const registryComponents = path.resolve(widgetSrc, "components");
const contentDir = path.resolve(__dirname, "content");
const contentExamplesComponents = path.join(
  contentDir,
  "components",
  "examples",
);

// Turbopack resolveAlias needs package specifiers or relative paths, not absolute.
// We point singleton packages to the landing app's copies so registry code
// (compiled via externalDir) shares the same Zustand store singletons.
const turbopackAliases: Record<string, string> = {
  "@/.source": "./.source",
  "@/app": "./app",
  "@/lib": "./lib",
  // Docs-only examples (API consoles, etc.) — must be listed before `@/components`.
  "@/components/examples": "./content/components/examples",
  // Widget + shadcn UI live in the registry package (docs MDX imports @/components/...).
  "@/components": "../shadcn-registry/src/components",
  // Docs-only interactive components (playground, API consoles) live under content/.
  "@/content": "./content",
  "@/hooks": "./src/hooks",
  "@aomi-labs/client": "../../packages/client/src/index.ts",
  "@aomi-labs/react": "../../packages/react/src/index.ts",
  "@aomi-labs/widget-lib/providers/para":
    "../shadcn-registry/src/lib/wallet-kit/providers/para/index.ts",
  "@aomi-labs/widget-lib/providers/privy":
    "../shadcn-registry/src/lib/wallet-kit/providers/privy/index.ts",
  "@aomi-labs/widget-lib": "../shadcn-registry/src/index.ts",
  "@assistant-ui/react": "./node_modules/@assistant-ui/react",
  "@assistant-ui/react-markdown": "./node_modules/@assistant-ui/react-markdown",
  "@getpara/react-sdk": "./node_modules/@getpara/react-sdk",
  "@tanstack/react-query": "./node_modules/@tanstack/react-query",
  // Force a single Zustand version so Para's SDK packages share the same store
  // implementation when registry code is compiled through externalDir.
  zustand: "./node_modules/zustand",
  viem: "./node_modules/viem",
  wagmi: "./node_modules/wagmi",
};

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || undefined,
  reactStrictMode: false,
  experimental: {
    externalDir: true,
  },
  async headers() {
    return [
      {
        source: "/embed-playground",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://aomilabs.mintlify.app https://*.mintlify.app",
          },
        ],
      },
    ];
  },
  transpilePackages: [
    "@aomi-labs/client",
    "@aomi-labs/react",
    "@aomi-labs/widget-lib",
    "@getpara/react-sdk",
  ],
  // Turbopack aliases (Next.js 16 default bundler) — ensures registry code
  // resolves @getpara/*, wagmi, viem to the same physical copies as the
  // landing app, preventing duplicate Zustand store singletons in pnpm.
  turbopack: {
    resolveAlias: turbopackAliases,
  },
  // Dev parity for the Mintlify docs proxy. In production the same rewrites
  // live in the root vercel.json (plus legacy-path redirects) and fire at the
  // edge; `next dev` doesn't read vercel.json, so without these local /docs
  // would 404.
  async rewrites() {
    return [
      {
        source: "/_mintlify/:path*",
        destination: "https://aomilabs.mintlify.dev/_mintlify/:path*",
      },
      { source: "/docs", destination: "https://aomilabs.mintlify.dev/docs" },
      {
        source: "/docs/:path*",
        destination: "https://aomilabs.mintlify.dev/docs/:path*",
      },
      {
        source: "/mintlify-assets/:path+",
        destination: "https://aomilabs.mintlify.dev/mintlify-assets/:path+",
      },
    ];
  },
  // Webpack aliases (production builds)
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@/.source": path.join(docsSrc, ".source"),
      "@/app": path.join(docsSrc, "app"),
      "@/lib": path.join(docsSrc, "lib"),
      "@/components/examples": contentExamplesComponents,
      "@/components": registryComponents,
      "@/content": contentDir,
      "@/hooks": path.join(landingSrc, "hooks"),
      "@aomi-labs/client": path.join(clientPkgSrc, "index.ts"),
      "@aomi-labs/react": path.join(reactPkgSrc, "index.ts"),
      "@aomi-labs/widget-lib/providers/para": path.join(
        widgetSrc,
        "lib/wallet-kit/providers/para/index.ts",
      ),
      "@aomi-labs/widget-lib/providers/privy": path.join(
        widgetSrc,
        "lib/wallet-kit/providers/privy/index.ts",
      ),
      "@aomi-labs/widget-lib": path.join(widgetSrc, "index.ts"),
      "@assistant-ui/react": path.join(
        landingNodeModules,
        "@assistant-ui/react",
      ),
      "@assistant-ui/react-markdown": path.join(
        landingNodeModules,
        "@assistant-ui/react-markdown",
      ),
      "@getpara/react-sdk": path.join(landingNodeModules, "@getpara/react-sdk"),
      "@tanstack/react-query": path.join(
        landingNodeModules,
        "@tanstack/react-query",
      ),
      zustand: path.join(landingNodeModules, "zustand"),
      viem: path.join(landingNodeModules, "viem"),
      wagmi: path.join(landingNodeModules, "wagmi"),
    };
    return config;
  },
};

export default withMDX(nextConfig);
