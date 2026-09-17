#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export function configurationErrors(env) {
  const errors = [];
  const evmKey = env.AOMI_HOSTED_E2E_EVM_PRIVATE_KEY ?? "";
  const svmKey = env.AOMI_HOSTED_E2E_SVM_SECRET_KEY ?? "";
  const chainId = env.AOMI_HOSTED_E2E_CHAIN_ID ?? "";
  const rpcUrl = env.AOMI_HOSTED_E2E_RPC_URL ?? "";

  if (!/^0x[0-9a-fA-F]{64}$/.test(evmKey)) {
    errors.push(
      "AOMI_HOSTED_E2E_EVM_PRIVATE_KEY must be a disposable 32-byte hex key",
    );
  }

  if (!svmKey) {
    errors.push("AOMI_HOSTED_E2E_SVM_SECRET_KEY is required");
  } else if (svmKey.startsWith("[")) {
    try {
      const bytes = JSON.parse(svmKey);
      if (
        !Array.isArray(bytes) ||
        bytes.length !== 64 ||
        bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
      ) {
        errors.push(
          "AOMI_HOSTED_E2E_SVM_SECRET_KEY must contain exactly 64 JSON bytes",
        );
      }
    } catch {
      errors.push(
        "AOMI_HOSTED_E2E_SVM_SECRET_KEY must be valid JSON bytes or base58",
      );
    }
  } else if (!/^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(svmKey)) {
    errors.push(
      "AOMI_HOSTED_E2E_SVM_SECRET_KEY must be a 64-byte JSON array or base58 key",
    );
  }

  if (chainId !== "84532") {
    errors.push("AOMI_HOSTED_E2E_CHAIN_ID must be Base Sepolia (84532)");
  }

  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== "https:")
      errors.push("AOMI_HOSTED_E2E_RPC_URL must use HTTPS");
  } catch {
    errors.push("AOMI_HOSTED_E2E_RPC_URL must be a valid HTTPS URL");
  }

  return errors;
}

async function verifyRpc(env) {
  const response = await fetch(env.AOMI_HOSTED_E2E_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (Number.parseInt(payload.result, 16) !== 84532) {
    throw new Error("RPC did not report Base Sepolia chain 84532");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = configurationErrors(process.env);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exit(1);
  }

  try {
    await verifyRpc(process.env);
  } catch (error) {
    console.error(
      `ERROR: AOMI_HOSTED_E2E_RPC_URL is not a reachable Base Sepolia RPC (${error.message})`,
    );
    process.exit(1);
  }

  console.log(
    "Hosted wallet configuration is present and targets Base Sepolia.",
  );
}
