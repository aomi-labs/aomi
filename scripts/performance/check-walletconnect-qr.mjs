// Real installed EthereumProvider + AppKit UI; only the external relay is faked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsup/package.json"))(
  "esbuild",
);
const widgetRequire = createRequire(resolve("packages/widget/package.json"));
const connectorsRequire = createRequire(
  createRequire(widgetRequire.resolve("wagmi/connectors")).resolve(
    "@wagmi/connectors",
  ),
);
const provider = connectorsRequire
  .resolve("@walletconnect/ethereum-provider")
  .replace("index.cjs.js", "index.es.js");
const events = createRequire(provider).resolve("events/");
const directory = mkdtempSync(join(tmpdir(), "aomi-qr-contract-"));
const uri =
  "wc:" + "01".repeat(32) + "@2?relay-protocol=irn&symKey=" + "02".repeat(32);
let browser;
const server = createServer((request, response) => {
  try {
    const file = request.url === "/" ? "index.html" : request.url.slice(1);
    if (!/^[\w.-]+$/.test(file)) throw new Error("Invalid asset");
    response.setHeader(
      "Content-Type",
      file.endsWith(".js") ? "text/javascript" : "text/html",
    );
    response.end(readFileSync(join(directory, file)));
  } catch {
    response.writeHead(404).end();
  }
});
try {
  await build({
    stdin: {
      contents: `import {EthereumProvider} from ${JSON.stringify(provider)};
        window.ready = EthereumProvider.init({projectId:'00000000000000000000000000000000',chains:[1],showQrModal:true}).then(provider => {
          document.querySelector('button').onclick = () => {
            window.pairingError = undefined;
            provider.connect().catch(error => { window.pairingError = error.message; });
          };
        });`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    outdir: directory,
    plugins: [
      {
        name: "controlled-relay",
        setup(bundler) {
          bundler.onResolve(
            { filter: /^@walletconnect\/universal-provider$/ },
            () => ({ path: "relay", namespace: "fixture" }),
          );
          bundler.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `import {EventEmitter} from ${JSON.stringify(events)};
          export const UniversalProvider = { async init() {
            return Object.assign(new EventEmitter(), {
              client: {core: {storage: {getItem:async()=>undefined,setItem:async()=>{}}}},
              logger: {error(){},warn(){}},
              connect() { return new Promise(() => {
                // Fast pairing must not lose the URI during first-use UI setup.
                setTimeout(() => this.emit('display_uri', ${JSON.stringify(uri)}), 0);
              }); },
              abortPairingAttempt(){}, disconnect:async()=>{}
            });
          }}; export default UniversalProvider;`,
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  writeFileSync(
    join(directory, "index.html"),
    '<button>Pair</button><script type="module" src="/stdin.js"></script>',
  );
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true });
  for (let cold = 1; cold <= 3; cold++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // No public relay/project credentials: serve deterministic optional metadata.
    await page.route("https://**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => window.ready);
    await expect(page.locator("w3m-modal")).toHaveCount(0);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.getByRole("button", { name: "Pair", exact: true }).click();
      await expect(page.locator("wui-qr-code")).toBeVisible();
      await expect
        .poll(() =>
          page.locator("wui-qr-code").evaluate((element) => element.uri),
        )
        .toBe(uri);
      await page.locator("w3m-modal").getByTestId("w3m-header-close").click();
      await expect
        .poll(() => page.evaluate(() => window.pairingError))
        .toMatch(/Connection request reset/);
      await expect(page.locator("wui-qr-code")).toBeHidden();
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Real WalletConnect QR: 3 cold browsers, 2 pairing/cancel attempts each passed.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  rmSync(directory, { recursive: true, force: true });
}
