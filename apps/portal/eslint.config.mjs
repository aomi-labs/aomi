import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
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
    // src/server/**) is intentionally out of scope.
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
              group: ["@portal/server/*", "**/server/*"],
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
