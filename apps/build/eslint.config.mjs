import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  // Global ignores (an entry with only `ignores` applies to every config).
  // .next*/** also covers NEXT_DIST_DIR overrides like .next-b / .next-verify
  // (multi-instance local runs), which eslint-config-next's own .next ignore
  // does not.
  { ignores: [".next*/**"] },
  ...nextVitals,
  {
    ignores: [".next/**", ".vercel/**", "out/**", "build/**", "next-env.d.ts"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Client/shared code must not import server-only modules. The `server-only`
    // poison pill already fails the build at runtime; this catches it at lint
    // time with a clearer message. Server code (app/api/**, app/**/{page,layout},
    // src/server/**) is intentionally out of scope. `allowTypeImports` lets
    // features/deploy use `import type { UserProject } from "@aomi-labs/deploy"`.
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/features/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@build/server/*", "**/server/*"],
              message:
                "Client/shared code must not import server-only modules — call a /api/bff route instead.",
              allowTypeImports: true,
            },
            {
              group: [
                "@aomi-labs/account",
                "@aomi-labs/account/*",
              ],
              message:
                "Node-only packages must not be imported from client/shared code.",
              allowTypeImports: true,
            },
            {
              // The deploy root and ./bff are server-only; ./lifecycle and
              // ./launch are the package's browser-safe entries.
              regex:
                "^@aomi-labs/deploy$|^@aomi-labs/deploy/(?!lifecycle$|launch$).+",
              message:
                "Node-only packages must not be imported from client/shared code.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
