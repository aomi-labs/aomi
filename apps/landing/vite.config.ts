import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { globSync, readdirSync, statSync } from "node:fs";
import publicKeys from "./public-env.keys.json" with { type: "json" };
const root = fileURLToPath(new URL(".", import.meta.url));
const workspace = resolve(root, "../..");
// Store only public directory metadata; static file bytes stay in Nitro's public output.
const researchFiles: Plugin = {
  name: "aomi-research-file-inventory",
  resolveId(id) {
    if (id === "virtual:aomi-research-files") return "\0" + id;
  },
  load(id) {
    if (id !== "\0virtual:aomi-research-files") return;
    const base = resolve(
      root,
      "public/research/aomibench-v0.1/aombench_v1_data",
    );
    const entries: Array<{
      path: string;
      isDirectory: boolean;
      size: number | null;
    }> = [];
    function collect(directory: string, prefix = "") {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".DS_Store") continue;
        const path = prefix + entry.name;
        const isDirectory = entry.isDirectory();
        entries.push({
          path,
          isDirectory,
          size: isDirectory ? null : statSync(join(directory, entry.name)).size,
        });
        if (isDirectory) collect(join(directory, entry.name), path + "/");
      }
    }
    collect(base);
    return `export default ${JSON.stringify(entries)};`;
  },
};
export default defineConfig(async ({ mode }) => {
  const env = { ...loadEnv(mode, root, ""), ...process.env };
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && process.env[key] === undefined)
      process.env[key] = value;
  const publicEnv: Record<string, string | undefined> = Object.fromEntries(
    publicKeys.map((key) => [key, env[key] || undefined]),
  );
  publicEnv.NEXT_PUBLIC_BACKEND_URL ||=
    env.BACKEND_URL || "http://127.0.0.1:8080";
  publicEnv.NEXT_PUBLIC_VERCEL_ENV ||= env.VERCEL_ENV || "";
  const docsMdx = await mdx(await import("./source.config"));
  const transformMdx = docsMdx.transform;
  if (typeof transformMdx !== "function")
    throw new Error("Fumadocs MDX transform is unavailable");
  // Native HTTP endpoints bundle exact raw bytes; the docs compiler must not rewrite them.
  docsMdx.transform = function (source, id, options) {
    if (new URLSearchParams(id.split("?", 2)[1]).has("raw")) return null;
    return transformMdx.call(this, source, id, options);
  };
  const config: UserConfig = {
    plugins: [
      docsMdx,
      researchFiles,
      tanstackStart({
        importProtection: {
          behavior: "error",
          include: ["**/apps/landing/src/**", "**/packages/account/src/**"],
          client: {
            files: ["**/*.server.*", "**/src/server/**"],
            specifiers: [
              "server-only",
              /^@aomi-labs\/account(?:$|\/(?!better-auth\/client))/,
            ],
          },
        },
      }),
      nitro({
        preset: env.VERCEL === "1" ? "vercel" : "node-server",
        routeRules: {
          // Marketing pages were statically generated under Next; cache them
          // per deployment instead of rendering every request.
          ...Object.fromEntries(
            [
              "/",
              "/about",
              "/agents",
              "/agents/**",
              "/blog",
              "/contact",
              "/pricing",
              "/pricing/**",
              "/privacy",
              "/products/**",
              "/research",
              "/research/**",
              "/solutions/**",
              "/terms",
            ].map((path) => [path, { isr: true }]),
          ),
          // Public files bypass Start; keep the registry handler's cache policy on existing assets.
          ...Object.fromEntries(
            globSync("**/*.json", { cwd: resolve(root, "public/r") }).map(
              (file) => [
                `/r/${file.replaceAll("\\", "/")}`,
                {
                  headers: {
                    "Cache-Control":
                      "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
                  },
                },
              ],
            ),
          ),
        },
        vercel: {
          functionRules: {
            "/api/thread/updates": { maxDuration: 300 },
            "/api/thread/events": { maxDuration: 300 },
          },
        },
      }),
      react(),
    ],
    define: Object.fromEntries(
      Object.entries(publicEnv).map(([key, value]) => [
        `process.env.${key}`,
        value === undefined ? "undefined" : JSON.stringify(value),
      ]),
    ),
    resolve: {
      alias: [
        { find: "@/.source", replacement: resolve(root, ".source") },
        { find: "@/content", replacement: resolve(root, "content") },
        {
          find: "@/components/examples",
          replacement: resolve(root, "content/components/examples"),
        },
        { find: "@", replacement: resolve(root, "src") },
        {
          find: "server-only",
          replacement: "@tanstack/react-start/server-only",
        },
      ],
      dedupe: [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "@assistant-ui/react",
        "lucide-react",
        "viem",
        "wagmi",
        "zustand",
        "fumadocs-core",
        "fumadocs-ui",
      ],
    },
    ssr: {
      noExternal: [
        /^@aomi-labs\//,
        "fumadocs-core",
        "fumadocs-ui",
        "lucide-react",
        "tailwindcss",
      ],
    },
    // Hashed bundles get Nitro's immutable cache; keep them apart from the
    // hand-edited files in public/assets.
    build: { assetsDir: "_build" },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["localhost", "127.0.0.1", ".ts.net"],
      fs: { allow: [workspace] },
    },
  };
  return config;
});
