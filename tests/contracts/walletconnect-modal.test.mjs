import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import test from "node:test";

const widgetRequire = createRequire(resolve("packages/widget/package.json"));
const wagmiRequire = createRequire(widgetRequire.resolve("wagmi/connectors"));
const connectorRequire = createRequire(
  wagmiRequire.resolve("@wagmi/connectors"),
);
const providerPath = connectorRequire.resolve(
  "@walletconnect/ethereum-provider",
);
const providerRequire = createRequire(providerPath);

function fixture({
  restored = false,
  reject = false,
  showQrModal = true,
} = {}) {
  const calls = { imports: 0, create: 0, open: 0, close: 0, sign: 0 };
  const account = "eip155:1:0x0000000000000000000000000000000000000001";
  const session = { namespaces: { eip155: { accounts: [account] } } };
  let onModalState;
  const signer = Object.assign(new EventEmitter(), {
    client: {
      core: { storage: { getItem: async () => 1, setItem: async () => {} } },
    },
    logger: { error() {}, warn() {} },
    session: restored ? session : undefined,
    async connect() {
      calls.sign++;
      if (reject) {
        onModalState({ open: false });
        return undefined;
      }
      this.session = session;
      return session;
    },
    async authenticate() {
      this.session = session;
      return { session };
    },
    abortPairingAttempt() {},
    async disconnect() {
      this.session = undefined;
    },
  });
  const exports = {};
  runInNewContext(readFileSync(providerPath, "utf8"), {
    exports,
    console,
    require(name) {
      if (name === "@walletconnect/universal-provider")
        return { UniversalProvider: { init: async () => signer } };
      if (name === "@reown/appkit/core") {
        calls.imports++;
        return {
          createAppKit() {
            calls.create++;
            return {
              open() {
                calls.open++;
              },
              close() {
                calls.close++;
              },
              subscribeState(listener) {
                onModalState = listener;
              },
              showErrorMessage() {},
            };
          },
        };
      }
      return providerRequire(name);
    },
  });
  return {
    calls,
    init: () =>
      exports.EthereumProvider.init({
        projectId: "test",
        chains: [1],
        showQrModal,
      }),
  };
}

test("fresh setup and restored sessions do not import the QR interface", async () => {
  for (const restored of [false, true]) {
    const f = fixture({ restored });
    const provider = await f.init();
    assert.equal(f.calls.imports, 0);
    assert.equal(Boolean(provider.session), restored);
    if (restored) assert.equal(provider.accounts.length, 1);
  }
});

test("explicit pairing creates and reuses the same QR modal", async () => {
  const f = fixture();
  const provider = await f.init();
  await provider.connect();
  assert.equal(provider.accounts.length, 1);
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.open, 1);
  assert.equal(f.calls.close, 1);
  await provider.disconnect();
  await provider.connect();
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.open, 2);
});

test("closing QR still rejects pairing and closes the modal", async () => {
  const f = fixture({ reject: true });
  const provider = await f.init();
  await assert.rejects(provider.connect(), /Connection request reset/);
  assert.equal(f.calls.open, 1);
  assert.equal(f.calls.close, 1);
});

test("authentication opens QR, while showQrModal:false stays headless", async () => {
  const f = fixture();
  const provider = await f.init();
  await provider.authenticate({ chains: [1] });
  assert.equal(f.calls.open, 1);
  assert.equal(f.calls.close, 1);
  const headless = fixture({ showQrModal: false });
  await (await headless.init()).connect();
  assert.equal(headless.calls.imports, 0);
  assert.equal(headless.calls.sign, 1);
});
