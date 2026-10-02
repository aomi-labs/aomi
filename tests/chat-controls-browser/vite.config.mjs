import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";

const root = fileURLToPath(new URL("../../", import.meta.url));
export default {
  root: `${root}tests/chat-controls-browser`,
  cacheDir: "/tmp/issue-696-vite-cache",
  plugins: [react()],
  define: { "process.env": JSON.stringify({ NODE_ENV: "development" }) },
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@assistant-ui/react",
      "@tanstack/react-query",
    ],
    alias: [
      {
        find: /^@aomi-labs\/client$/,
        replacement: `${root}packages/client/src/index.ts`,
      },
      {
        find: /^@aomi-labs\/react$/,
        replacement: `${root}packages/react/src/index.ts`,
      },
      {
        find: /^@aomi-labs\/account$/,
        replacement: `${root}packages/account/src/index.ts`,
      },
      {
        find: /^@aomi-labs\/client\//,
        replacement: `${root}packages/client/src/`,
      },
      {
        find: /^@aomi-labs\/react\//,
        replacement: `${root}packages/react/src/`,
      },
      {
        find: /^@aomi-labs\/account\//,
        replacement: `${root}packages/account/src/`,
      },
      { find: /^@\//, replacement: `${root}apps/shadcn-registry/src/` },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3317,
    strictPort: true,
    fs: { allow: [root] },
  },
};
