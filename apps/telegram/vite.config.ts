import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import publicKeys from "./public-env.keys.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));
const workspace = resolve(root, "../..");

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ""), ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && process.env[key] === undefined)
      process.env[key] = value;
  }
  return {
    plugins: [
      tanstackStart({
        router: { routeFileIgnorePattern: "\\.(test|spec)\\.[jt]sx?$" },
        importProtection: {
          behavior: "error",
          include: ["**/apps/telegram/src/**", "**/packages/account/src/**"],
          client: {
            files: ["**/*.server.*", "**/src/server/**"],
            specifiers: ["server-only", /^@aomi-labs\/account(?:$|\/)/],
          },
        },
      }),
      nitro({ preset: env.VERCEL === "1" ? "vercel" : "node-server" }),
      react(),
    ],
    define: Object.fromEntries(
      publicKeys.map((key) => [
        `process.env.${key}`,
        env[key] === undefined ? "undefined" : JSON.stringify(env[key]),
      ]),
    ),
    resolve: {
      alias: [
        { find: "@", replacement: resolve(root, "src") },
        {
          find: "@aomi-labs/client",
          replacement: resolve(workspace, "packages/client/src"),
        },
        {
          find: "@aomi-labs/react",
          replacement: resolve(workspace, "packages/react/src"),
        },
        // Only the Privy-free widget UI and tokens cross this app boundary.
        ...["button", "card"].map((entry) => ({
          find: `@aomi-labs/widget/components/ui/${entry}`,
          replacement: resolve(
            workspace,
            `packages/widget/src/ui/${entry}.tsx`,
          ),
        })),
        {
          find: "@aomi-labs/widget/themes/default.css",
          replacement: resolve(
            workspace,
            "packages/widget/src/themes/default.css",
          ),
        },
        {
          find: "server-only",
          replacement: "@tanstack/react-start/server-only",
        },
      ],
      dedupe: ["react", "react-dom", "@tanstack/react-query", "lucide-react"],
    },
    ssr: { noExternal: [/^@aomi-labs\//, "lucide-react", "tailwindcss"] },
    // Hashed bundles get Nitro's immutable cache; keep them apart from the
    // hand-edited files in public/assets.
    build: { assetsDir: "_build" },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["localhost", "127.0.0.1", ".ts.net"],
      fs: { allow: [workspace] },
    },
  };
});
