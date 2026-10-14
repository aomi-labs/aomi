import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const [nextConfig] = compat.extends("next/core-web-vitals", "next/typescript");

const eslintConfig = [
  {
    ignores: [
      "**/.next*/**",
      "**/output/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/node_modules/**",
    ],
  },
  {
    ...nextConfig,
    files: ["**/*.ts", "**/*.tsx"],
    ignores: [
      "**/.next*/**",
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.turbo/**",
    ],
    languageOptions: {
      ...(nextConfig?.languageOptions ?? {}),
      parser: tsParser,
    },
    plugins: {
      ...(nextConfig?.plugins ?? {}),
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...(nextConfig?.rules ?? {}),
      // We lint a library + an example app; there is no root pages/app dir.
      "next/no-html-link-for-pages": "off",
      // We use React 17+ JSX transform; no need for React in scope.
      "react/react-in-jsx-scope": "off",
      // TS types handle props; no runtime prop-types.
      "react/prop-types": "off",
    },
    settings: {
      ...(nextConfig?.settings ?? {}),
      react: {
        version: "detect",
      },
    },
  },
];

export default eslintConfig;
