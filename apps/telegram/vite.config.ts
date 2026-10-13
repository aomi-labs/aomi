import { defineConfig, mergeConfig } from "vite";
import { appConfig, loadAppEnv } from "@aomi-labs/app-kit/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const workspace = resolve(root, "../..");

export default defineConfig(({ mode }) =>
  mergeConfig(
    appConfig({
      root,
      env: loadAppEnv(root, mode),
      router: { routeFileIgnorePattern: "\\.(test|spec)\\.[jt]sx?$" },
      importProtection: {
        include: ["**/apps/telegram/src/**", "**/packages/account/src/**"],
        specifiers: ["server-only", /^@aomi-labs\/account(?:$|\/)/],
      },
    }),
    {
      resolve: {
        alias: [
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
        ],
      },
      ssr: { noExternal: [/^@aomi-labs\//] },
    },
  ),
);
