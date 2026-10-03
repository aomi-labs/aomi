#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import tailwindcss from "@tailwindcss/postcss";

const require = createRequire(import.meta.url);
const { createServer } = await import(
  createRequire(require.resolve("vitest/package.json")).resolve("vite")
);
const { default: react } = await import(
  createRequire(
    new URL("../apps/shadcn-registry/package.json", import.meta.url),
  ).resolve("@vitejs/plugin-react")
);
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "output/playwright/onchain-links");
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve(root, "tests/onchain-links-browser"),
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: {
    dedupe: ["react", "react-dom", "@assistant-ui/react"],
    alias: [
      { find: /^@\//, replacement: `${root}apps/shadcn-registry/src/` },
      {
        find: /^@aomi-labs\/client$/,
        replacement: `${root}packages/client/src/index.ts`,
      },
      {
        find: /^@aomi-labs\/react$/,
        replacement: `${root}packages/react/src/index.ts`,
      },
    ],
  },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // This fixture has no backend and must never contact a live explorer.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.goto(server.resolvedUrls.local[0], { waitUntil: "networkidle" });
  const links = page.locator(".aui-md a");
  await expect(links).toHaveCount(10);
  for (const name of [
    "Solana account",
    "Wrapped SOL",
    "Solana transaction",
    "same account",
  ]) {
    const link = page.getByRole("link", {
      name: `${name} on Solana explorer`,
      exact: true,
    });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveClass(/text-aomi-accent/);
  }
  const codeLink = page
    .locator(".aui-md a")
    .filter({ has: page.locator("code") });
  await expect(codeLink).toHaveCount(1);
  await expect(codeLink).toHaveAttribute(
    "href",
    "https://SOLSCAN.io:443/account/So11111111111111111111111111111111111111112",
  );
  await expect(page.locator(".aui-md a a")).toHaveCount(0);
  for (const name of ["Devnet", "wrong size"]) {
    await expect(
      page.getByRole("link", { name, exact: true }),
    ).not.toHaveAttribute("target");
  }
  await expect(
    page.getByRole("link", { name: "Base account on Base explorer" }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", {
      name: "Robinhood account on Robinhood Chain explorer",
    }),
  ).toHaveAttribute("target", "_blank");
  await expect(page.locator(".aui-md pre a")).toHaveCount(0);
  await expect(page.locator(".aui-md pre code")).toContainText(
    "[code only](https://solscan.io/account/",
  );
  await expect(
    page
      .locator(".aui-md p")
      .filter({ hasText: "Bare ambiguous identifiers:" })
      .locator("a"),
  ).toHaveCount(0);
  await expect(
    page.locator(".aui-md p").filter({ hasText: "Inline code:" }).locator("a"),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: resolve(output, "existing-explorer-links.png"),
    fullPage: true,
  });
  const rendered = await links.evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent,
      href: node.getAttribute("href"),
      target: node.getAttribute("target"),
      rel: node.getAttribute("rel"),
    })),
  );
  const account = "So11111111111111111111111111111111111111112";
  const transaction =
    "uzUc9i1WChEcyuQFT5v7Bn9s4WzGnbNqg8NPyDA8r7GRpmUsctac7hLvyvbiM1Cz3GC9KZZPvKD6RMAdoroX2Aj";
  assert.deepEqual(
    rendered.map((link) => link.href),
    [
      `https://solscan.io/account/${account}`,
      `https://solscan.io/token/${account}`,
      `https://solscan.io/tx/${transaction}`,
      `https://SOLSCAN.io:443/account/${account}`,
      `https://solscan.io/account/${account}`,
      `https://solscan.io/account/${account}`,
      `https://basescan.org/address/0x${"b".repeat(40)}`,
      `https://robinhoodchain.blockscout.com/address/0x${"b".repeat(40)}`,
      `https://solscan.io/account/${account}?cluster=devnet`,
      `https://solscan.io/tx/${account}`,
    ],
  );
  await writeFile(
    resolve(output, "rendered-links.json"),
    JSON.stringify(rendered, null, 2),
  );
  console.log(
    `PASS: 10 existing Markdown links; Solana/EVM styling, exact hrefs, duplicate/code preservation and no bare linkification. Artifacts: ${output}`,
  );
} finally {
  await browser?.close();
  await server.close();
}
