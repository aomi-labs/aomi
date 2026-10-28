import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { loadEnv, type PluginOption, type UserConfig } from "vite";
import { deployTarget, type AppEnv } from "./platform.ts";

export type { AppEnv };
type StartOptions = NonNullable<Parameters<typeof tanstackStart>[0]>;
type NitroOptions = NonNullable<Parameters<typeof nitro>[0]>;

/** Modules the client graph must never import (server-side account code). */
export const serverOnlySpecifiers: Array<string | RegExp> = [
  "server-only",
  /^@aomi-labs\/account(?:$|\/(?!better-auth\/client))/,
];

const shim = (file: string) =>
  fileURLToPath(new URL(`../shims/${file}`, import.meta.url));

/** Load `.env*` for `mode` into process.env without overriding set values. */
export function loadAppEnv(root: string, mode: string): AppEnv {
  const env: AppEnv = { ...loadEnv(mode, root, ""), ...process.env };
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && process.env[key] === undefined)
      process.env[key] = value;
  return env;
}

export interface AppConfigOptions {
  /** App directory: holds src/, .env files and public-env.keys.json. */
  root: string;
  env: AppEnv;
  /** Fallbacks for public keys that are unset or blank. */
  publicEnv?: AppEnv;
  /** Plugins that run before TanStack Start. */
  plugins?: PluginOption[];
  importProtection?: {
    include?: string[];
    /** Client-forbidden specifiers; defaults to `serverOnlySpecifiers`. */
    specifiers?: Array<string | RegExp>;
  };
  /** Static pages rendered at build time. */
  prerender?: Pick<StartOptions, "pages" | "prerender">;
  nitro?: Omit<NitroOptions, "preset">;
  /** Map `@/` to src/ (default true). */
  sourceAlias?: boolean;
  /** Stub wallet dependencies that cannot load in these hosts. */
  walletShims?: boolean;
  host?: string;
}

/**
 * The Vite config every Start app shares; apps add their own parts with
 * `mergeConfig` (merged plugins run after these, merged aliases before).
 */
export function appConfig(options: AppConfigOptions): UserConfig {
  const { root, env } = options;
  const workspace = resolve(root, "../..");
  const keys: string[] = JSON.parse(
    readFileSync(resolve(root, "public-env.keys.json"), "utf8"),
  );
  const fallbacks = options.publicEnv ?? {};
  const publicKeys = new Set([...keys, ...Object.keys(fallbacks)]);
  const { include, specifiers = serverOnlySpecifiers } =
    options.importProtection ?? {};
  return {
    plugins: [
      ...(options.plugins ?? []),
      tanstackStart({
        ...options.prerender,
        importProtection: {
          behavior: "error",
          ...(include && { include }),
          client: { files: ["**/*.server.*", "**/src/server/**"], specifiers },
        },
      }),
      nitro({
        ...(deployTarget(env) === "cloudflare"
          ? {
              preset: "cloudflare-module",
              // Some dependencies ship only browser and node builds; workerd
              // takes whichever the package lists first (nodejs_compat).
              exportConditions: ["browser", "node"],
            }
          : { preset: "vercel" }),
        ...options.nitro,
      }),
      react(),
    ],
    // Public values are inlined by name; blank values count as unset.
    define: Object.fromEntries(
      [...publicKeys].map((key) => {
        const value = env[key] || fallbacks[key];
        return [
          `process.env.${key}`,
          value === undefined ? "undefined" : JSON.stringify(value),
        ];
      }),
    ),
    resolve: {
      alias: [
        ...(options.sourceAlias === false
          ? []
          : [{ find: "@", replacement: resolve(root, "src") }]),
        {
          find: "server-only",
          replacement: "@tanstack/react-start/server-only",
        },
        ...(options.walletShims
          ? [
              {
                find: "@noble/hashes/_assert",
                replacement: shim("noble-hashes-assert-compat.js"),
              },
              ...[
                "@farcaster/miniapp-sdk",
                "@farcaster/mini-app-solana",
                "@farcaster/miniapp-wagmi-connector",
                "@getpara/ethers-v6-integration",
                "pino-pretty",
              ].map((find) => ({
                find,
                replacement: shim("empty-module.js"),
              })),
            ]
          : []),
      ],
      dedupe: ["react", "react-dom", "@tanstack/react-query", "lucide-react"],
    },
    ssr: { noExternal: ["lucide-react", "tailwindcss"] },
    // Hashed bundles get Nitro's immutable cache; keep them apart from the
    // hand-edited files in public/assets.
    build: { assetsDir: "_build" },
    server: {
      host: options.host ?? "127.0.0.1",
      allowedHosts: ["localhost", "127.0.0.1", ".ts.net"],
      fs: { allow: [workspace] },
    },
  };
}
