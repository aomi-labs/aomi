import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      ".next/**",
      ".output/**",
      ".tanstack/**",
      ".vercel/**",
      "dist/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tsPlugin, react, "react-hooks": hooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
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
              group: ["**/server/*"],
              message:
                "Client code must call an authorized HTTP route instead of importing server modules.",
              allowTypeImports: true,
            },
            {
              group: ["@aomi-labs/account", "@aomi-labs/account/*"],
              message:
                "Node-only account modules must stay behind the server boundary.",
              allowTypeImports: true,
            },
            {
              regex:
                "^@aomi-labs/deploy$|^@aomi-labs/deploy/(?!lifecycle$|launch$).+",
              message: "Use a browser-safe deployment entrypoint.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];
