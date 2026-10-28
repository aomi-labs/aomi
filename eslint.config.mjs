import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import react from "eslint-plugin-react";

/**
 * First-party code talks to Aomi one way: one `new Aomi()` and its namespaces.
 * Better Auth's own endpoints (`/api/auth/*`) and an app's own BFF routes
 * (`/api/bff/*`) are not the Aomi API and stay plain fetches.
 */
// esquery regexes cannot contain "/": \x2F stands for it.
const AOMI_PATH = "/^\\x2F(?:api\\x2F(?!auth\\x2F|bff\\x2F)|v1(?:\\x2F|$))/";
const fetchOf = (callee) => [
  `CallExpression[${callee}][arguments.0.type='Literal'][arguments.0.value=${AOMI_PATH}]`,
  `CallExpression[${callee}][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.raw=${AOMI_PATH}]`,
];
export const oneAomi = {
  files: [
    "apps/*/src/**/*.{ts,tsx}",
    "packages/widget/src/**/*.{ts,tsx}",
    "packages/react/src/**/*.{ts,tsx}",
  ],
  ignores: ["**/*.test.{ts,tsx}", "**/test/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      ...["AomiClient", "ClientSession"].map((name) => ({
        selector: `NewExpression[callee.name='${name}']`,
        message: `Use one \`new Aomi()\` and its namespaces, not a hand-wired ${name}.`,
      })),
      {
        selector:
          "CallExpression[callee.property.name='request'][callee.object.property.name='raw']",
        message: "Call the Aomi namespace for this route, not `raw.request`.",
      },
      ...[
        ...fetchOf("callee.name='fetch'"),
        ...fetchOf("callee.property.name='fetch'"),
      ].map((selector) => ({
        selector,
        message: "Call the Aomi API through `new Aomi()`, not a raw fetch.",
      })),
    ],
  },
};

export default [
  {
    ignores: [
      // Build output folders, but not the Build app.
      "**/build/**",
      "!apps/build/",
      "!apps/build/**",
      "**/.next*/**",
      "**/output/**",
      "**/.output/**",
      "**/.vercel/**",
      "**/.tanstack/**",
      "**/routeTree.gen.ts",
      "**/dist/**",
      "**/.turbo/**",
      "**/.wrangler/**",
      "**/node_modules/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tsPlugin, react },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      // React 17+ JSX transform; no need for React in scope.
      "react/react-in-jsx-scope": "off",
      // TS types handle props; no runtime prop-types.
      "react/prop-types": "off",
    },
  },
  oneAomi,
];
