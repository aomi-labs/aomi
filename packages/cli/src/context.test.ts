// @vitest-environment node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/aomi-cli-context-test-${process.pid}`;
  process.env.AOMI_STATE_DIR = path;
  return path;
});

// No node is reached: only the account each transaction is sent from is kept.
const sentFrom = vi.hoisted(() => [] as string[]);
const receipt = vi.hoisted(() => ({
  wait: async (): Promise<{ status: string }> => ({ status: "success" }),
}));
vi.mock("viem", async (original) => {
  const real = await original<typeof import("viem")>();
  return {
    ...real,
    createWalletClient: (
      config: Parameters<typeof real.createWalletClient>[0],
    ) =>
      Object.assign(real.createWalletClient(config), {
        sendTransaction: async () => {
          sentFrom.push((config.account as { address: string }).address);
          return "0xhash";
        },
      }),
    createPublicClient: () => ({
      waitForTransactionReceipt: () => receipt.wait(),
    }),
  };
});

import { connect, policySigner } from "./context";

const CHECKED =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SAVED_LATER =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const save = (evmKey: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cli.json"), JSON.stringify({ evmKey }));
};

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  sentFrom.length = 0;
  delete process.env.AOMI_PRIVATE_KEY;
});

it("sends a policy transaction with the key the client was connected with, not one saved since", async () => {
  save(CHECKED);
  const aomi = await connect({ backendUrl: "https://chat.example" });
  const checked = privateKeyToAccount(CHECKED).address;
  expect(aomi.wallet?.evm?.address).toBe(checked);
  // `aomi wallets signer set` in another terminal, while the owner is asked.
  save(SAVED_LATER);
  const signer = policySigner(aomi, {});
  expect(signer.evmAddress).toBe(checked);
  const hash = await signer.sendEvmTransaction!({
    chainId: 8453,
    to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
    data: "0x",
    value: "0x0",
  });
  expect(hash).toBe("0xhash");
  expect(sentFrom).toEqual([checked]);
});

it("answers the hash of a sent transaction whose receipt does not come, and refuses a reverted one by its hash", async () => {
  save(CHECKED);
  const signer = policySigner(
    await connect({ backendUrl: "https://chat.example" }),
    {},
  );
  const send = () =>
    signer.sendEvmTransaction!({
      chainId: 8453,
      to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
      data: "0x",
      value: "0x0",
    });
  const held = receipt.wait;
  try {
    receipt.wait = async () => {
      throw new Error("Timed out while waiting for transaction");
    };
    expect(await send()).toBe("0xhash");
    receipt.wait = async () => ({ status: "reverted" });
    await expect(send()).rejects.toThrow("The transaction reverted: 0xhash");
  } finally {
    receipt.wait = held;
  }
});
