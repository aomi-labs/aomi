import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import react from "eslint-plugin-react";

export default [
  {
    ignores: [
      "**/.next*/**",
      "**/output/**",
      "**/.output/**",
      "**/.vercel/**",
      "**/.tanstack/**",
      "**/routeTree.gen.ts",
      "**/dist/**",
      "**/build/**",
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
];
