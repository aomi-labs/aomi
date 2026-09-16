import assert from "node:assert/strict";
import test from "node:test";
import { configurationErrors } from "../../.github/scripts/validate-hosted-wallet-env.mjs";

const valid = {
  AOMI_HOSTED_E2E_EVM_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  AOMI_HOSTED_E2E_SVM_SECRET_KEY: JSON.stringify(
    Array.from({ length: 64 }, (_, index) => index),
  ),
  AOMI_HOSTED_E2E_CHAIN_ID: "84532",
  AOMI_HOSTED_E2E_RPC_URL: "https://sepolia.base.org",
};

test("accepts complete disposable Base Sepolia configuration", () => {
  assert.deepEqual(configurationErrors(valid), []);
});

test("reports every missing or malformed input by name", () => {
  const errors = configurationErrors({
    AOMI_HOSTED_E2E_EVM_PRIVATE_KEY: "bad",
    AOMI_HOSTED_E2E_SVM_SECRET_KEY: "[]",
    AOMI_HOSTED_E2E_CHAIN_ID: "8453",
    AOMI_HOSTED_E2E_RPC_URL: "http://localhost:8545",
  });
  assert.equal(errors.length, 4);
  assert.match(errors.join("\n"), /EVM_PRIVATE_KEY/);
  assert.match(errors.join("\n"), /SVM_SECRET_KEY/);
  assert.match(errors.join("\n"), /CHAIN_ID/);
  assert.match(errors.join("\n"), /RPC_URL/);
});
