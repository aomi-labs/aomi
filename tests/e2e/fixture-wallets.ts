import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

// Deterministic throwaway keys: every run signs with the same test wallets.
const bytes = (label: string) =>
  createHash("sha256").update(`aomi-browser-contract:${label}`).digest();

const evm = ["evm-1", "evm-2"].map(
  (label) => `0x${bytes(label).toString("hex")}` as const,
);

export const fixtureKeys = {
  evm,
  evmAddress: privateKeyToAccount(evm[0]!).address,
  svm: JSON.stringify([...bytes("svm-1")]),
};
