import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";

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
const entry = connectorsRequire.resolve("@coinbase/wallet-sdk");
const root = dirname(entry);
const optional = [
  ["getCryptoKeyAccount", "../../kms/crypto-key/index.js"],
  ["createSubAccountSigner", "./utils/createSubAccountSigner.js"],
  ["handleAddSubAccountOwner", "./utils/handleAddSubAccountOwner.js"],
  ["handleInsufficientBalanceError", "./utils/handleInsufficientBalance.js"],
];

test("Coinbase patch only changes imports at existing awaited operation sites", () => {
  let source = readFileSync(resolve(root, "sign/scw/SCWSigner.js"), "utf8");
  for (const [name, path] of optional) {
    assert.ok(source.includes(`await (await import('${path}')).${name}(`));
    source = source.replaceAll(
      `await (await import('${path}')).${name}(`,
      `await ${name}(`,
    );
  }
  // Version-bound upstream body with just these four static imports removed.
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "6d899bc26cb74ca5c435a5c0d76394686938111a736d236f96e275a69e47ccb0",
  );
});

test("Coinbase startup bundle defers optional operation implementations", async () => {
  const result = await build({
    stdin: {
      contents: `import {createCoinbaseWalletSDK} from ${JSON.stringify(entry)}; window.makeWallet = createCoinbaseWalletSDK;`,
      resolveDir: process.cwd(),
    },
    outdir: "/tmp/aomi-coinbase-contract",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    metafile: true,
    write: false,
  });
  const outputs = result.metafile.outputs;
  const initial = new Set();
  function visit(path) {
    if (initial.has(path)) return;
    initial.add(path);
    for (const imported of outputs[path].imports)
      if (!imported.external && imported.kind !== "dynamic-import")
        visit(imported.path);
  }
  for (const [path, output] of Object.entries(outputs))
    if (output.entryPoint === "<stdin>") visit(path);
  assert.ok(initial.size > 0);
  const startupInputs = new Set(
    [...initial].flatMap((path) => Object.keys(outputs[path].inputs)),
  );
  const allInputs = new Set(
    Object.values(outputs).flatMap((output) => Object.keys(output.inputs)),
  );
  for (const filename of [
    "createSubAccountSigner.js",
    "handleAddSubAccountOwner.js",
    "handleInsufficientBalance.js",
  ]) {
    assert.ok(
      [...allInputs].some((path) => path.endsWith("/" + filename)),
      `${filename} must still ship`,
    );
    assert.ok(
      ![...startupInputs].some((path) => path.endsWith("/" + filename)),
      `${filename} must load on demand`,
    );
  }
});
