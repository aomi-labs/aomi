import { defineConfig, mergeConfig, type Plugin } from "vite";
import mdx from "fumadocs-mdx/vite";
import { appConfig, loadAppEnv } from "@aomi-labs/app-kit/vite";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { globSync, readdirSync, statSync } from "node:fs";
const root = fileURLToPath(new URL(".", import.meta.url));
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
// Retired docs paths, served before the Mintlify proxy on every preset.
// Pages also redirect their `.md` twin; a `:md` target keeps that suffix.
const docsPages: Record<string, string> = {
  introduction: "",
  "start-here": "",
  "about-aomi": "/build",
  "agentic-application": "/build",
  "non-custodial-wallet": "/concepts/non-custodial-wallets:md",
  changelog: "/resources/changelog:md",
  troubleshooting: "/guides/troubleshooting:md",
  "advanced/cli": "/reference/cli:md",
  "advanced/evals": "/build/plugins/evals:md",
  "advanced/execution": "/trade/execution:md",
  "advanced/script-generation": "/concepts/how-it-works:md",
  "advanced/sdk": "/build/plugins/sdk:md",
  "build/cli": "/build/toolchain/aomi-build:md",
  "build/frontend-setup": "/guides/frontend-setup:md",
  "build/getting-started": "/build",
  "build/headless-library": "/guides/headless-library:md",
  "build/how-it-works": "/concepts/how-it-works:md",
  "build/integration-guide": "/guides/integration:md",
  "build/namespaces": "/build/plugins/anatomy:md",
  "build/overview": "/build",
  "build/widget-installation": "/guides/widget-installation:md",
  "build/services/api-reference": "/reference/api-reference:md",
  "build/services/building-apps": "/build/plugins/anatomy:md",
  "build/services/sessions": "/reference/sessions:md",
  "build/services/telegram-bot": "/build/telegram-bot:md",
  "build/services/wallet-integration": "/concepts/non-custodial-wallets:md",
  "build/ui/headless/hooks": "/guides/headless/hooks:md",
  "build/ui/headless/build-custom-ui": "/guides/headless/build-custom-ui:md",
  "reference/account-abstraction": "/trade/execution:md",
  "reference/architecture": "/concepts/architecture:md",
  "reference/sdk": "/build/plugins/sdk:md",
  "reference/sdk-api": "/build/plugins/sdk:md",
  "reference/building-apps": "/build/plugins/anatomy:md",
  "reference/cli-toolchain": "/build/toolchain/aomi-build:md",
  "build/deploy-cli": "/build/toolchain/aomi-build:md",
  "guides/custom-tools": "/build/plugins/custom-tools:md",
  "guides/evals-testing": "/build/plugins/evals:md",
  "use-aomi/quickstart": "/reference/cli:md",
  "getting-started/quickstart": "/reference/cli:md",
  "use-aomi/faq": "/resources/faq:md",
};
// Whole retired sections.
const docsSections: Record<string, string> = {
  "build/ui/headless": "/guides/headless-library",
  "build/ui/widget": "/guides/widget-installation",
  transact: "/trade",
  "use-aomi/telegram": "/getting-started/telegram",
  "use-aomi/web": "/getting-started/web-app",
  "use-aomi/discord": "/getting-started/discord",
  "use-aomi/ios": "/getting-started/ios",
};
const permanent = (to: string) => ({
  redirect: { to: `/docs${to}`, status: 308 },
});
const docsRedirects = Object.fromEntries([
  ...Object.entries(docsPages).flatMap(([from, to]) => {
    const page = to.replace(/:md$/, "");
    return [
      [`/docs/${from}`, permanent(page)],
      [`/docs/${from}.md`, permanent(to === page ? page : `${page}.md`)],
    ];
  }),
  ...Object.entries(docsSections).flatMap(([from, to]) => [
    [`/docs/${from}`, permanent(to)],
    [`/docs/${from}/**`, permanent(to)],
  ]),
]);
export default defineConfig(async ({ mode }) => {
  const env = loadAppEnv(root, mode);
  const docsMdx = await mdx(await import("./source.config.ts"));
  const transformMdx = docsMdx.transform;
  if (typeof transformMdx !== "function")
    throw new Error("Fumadocs MDX transform is unavailable");
  // Native HTTP endpoints bundle exact raw bytes; the docs compiler must not rewrite them.
  docsMdx.transform = function (source, id, options) {
    if (new URLSearchParams(id.split("?", 2)[1]).has("raw")) return null;
    return transformMdx.call(this, source, id, options);
  };
  const base = appConfig({
    root,
    env,
    publicEnv: {
      NEXT_PUBLIC_BACKEND_URL: env.BACKEND_URL || "http://127.0.0.1:8080",
    },
    plugins: [docsMdx, researchFiles],
    protect: ["**/apps/landing/src/**"],
    nitro: {
      // Static pages render once at build, as under Next; the crawler adds
      // the posts, docs examples and research data they link to. Redirects,
      // proxies, public files and per-request routes stay off the list.
      prerender: {
        routes: [
          "/",
          "/about",
          "/agents",
          "/agents/build",
          "/agents/transact",
          "/blog",
          "/contact",
          "/pricing",
          "/pricing/payment-rails",
          "/privacy",
          "/privy",
          "/research",
          "/terms",
          "/examples/polymarket",
          "/playground/configurator",
          "/agents.md",
          "/agents/build.md",
          "/agents/transact.md",
          "/brand.md",
          "/faq.md",
          "/llms.txt",
          "/llms-full.txt",
          "/robots.txt",
          "/sitemap.xml",
        ],
        crawlLinks: true,
        ignore: [
          "/api",
          "/docs",
          "/_mintlify",
          "/mintlify-assets",
          "/embed-playground",
          "/r/",
          "/assets/",
          "/research/aomibench-v0.1/",
          // Redirects would be written as empty files.
          /^\/(news|examples|playground)$/,
          /.\/$/,
        ],
      },
      routeRules: {
        ...docsRedirects,
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
    },
  });
  return mergeConfig(base, {
    resolve: {
      // Before the shared `@` alias.
      alias: [
        { find: "@/.source", replacement: resolve(root, ".source") },
        { find: "@/content", replacement: resolve(root, "content") },
        {
          find: "@/components/examples",
          replacement: resolve(root, "content/components/examples"),
        },
      ],
      dedupe: [
        "@assistant-ui/react",
        "viem",
        "wagmi",
        "zustand",
        "fumadocs-core",
        "fumadocs-ui",
      ],
    },
    ssr: { noExternal: [/^@aomi-labs\//, "fumadocs-core", "fumadocs-ui"] },
  });
});
