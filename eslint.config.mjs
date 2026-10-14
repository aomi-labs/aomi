import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";

const eslintConfig = [
  {
    ignores: [
      "**/.next*/**",
      "**/.output/**",
      "**/.tanstack/**",
      "**/.vercel/**",
      "**/routeTree.gen.ts",
      "**/output/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
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
      // We use React 17+ JSX transform; no need for React in scope.
      "react/react-in-jsx-scope": "off",
      // TS types handle props; no runtime prop-types.
      "react/prop-types": "off",
    },
  },
];

export default eslintConfig;
