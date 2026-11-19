import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "./vault-model";
import { withdrawFromVault } from "./vault-withdraw-flow";
const owner = privateKeyToAccount(
  keccak256(stringToHex("aomi-vault-withdraw-flow-test/owner")),
);
const VAULT = "0x7c4c1f0a2b3d4e5f60718293a4b5c6d7e8f9e079";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const NOW = 1_800_000_000;
const vault: Vault = {
  key: `8453:${VAULT}`,
  address: VAULT,
  chainId: 8453,
  chain: { label: "Base", network: "eip155:8453" },
  owner: owner.address,
};

const wallet = {
  identity: { address: owner.address as string | undefined, chainId: 1 },
  switchChain: vi.fn(async () => {}),
  signTypedData: vi.fn(async ({ typed_data }: { typed_data: Typed }) => ({
    signature: await owner.signTypedData(typed_data),
  })),
  sendTransaction: vi.fn(async () => ({ txHash: "0xsent" })),
};
type Kit = Parameters<typeof withdrawFromVault>[0];
type Typed = Parameters<typeof owner.signTypedData>[0];
const hasCode = vi.fn();
const run = (extra: object = {}, kit: object = wallet) =>
  withdrawFromVault(
    kit as Kit,
    { hasCode },
    {
      vault,
      asset: { erc20: USDC },
      amount: BigInt(2_500_000),
      ...extra,
    },
  );
const expectNothingSigned = () => {
  expect(wallet.signTypedData).not.toHaveBeenCalled();
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
};

beforeEach(() => {
  wallet.identity = { address: owner.address, chainId: 1 };
  vi.clearAllMocks();
  hasCode.mockResolvedValue(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

describe("withdrawing from the vault", () => {
  it("asks nothing of the wallet when the vault has no code yet", async () => {
    hasCode.mockResolvedValueOnce(false);
    expect(await run()).toBe("no_vault");
    expect(wallet.switchChain).not.toHaveBeenCalled();
    expectNothingSigned();
  });

  it("refuses another wallet, no wallet, a zero amount and a wallet that cannot send, before anything", async () => {
    wallet.identity.address = `0x${"1".repeat(40)}`;
    await expect(run()).rejects.toThrow(
      "Send this from the wallet that owns the vault. Nothing was signed.",
    );
    wallet.identity.address = undefined;
    await expect(run()).rejects.toThrow("Nothing was signed.");
    wallet.identity.address = owner.address;
    await expect(run({ amount: BigInt(0) })).rejects.toThrow(
      "The amount must be above 0.",
    );
    const noSend = { ...wallet, sendTransaction: undefined };
    await expect(run({}, noSend)).rejects.toThrow(
      "This wallet can't sign that.",
    );
    expect(hasCode).not.toHaveBeenCalled();
    expectNothingSigned();
  });

  it("sends nothing after a declined or unusable signature, and passes wallet errors on", async () => {
    wallet.signTypedData.mockRejectedValueOnce(new Error("User rejected"));
    await expect(run()).rejects.toThrow("User rejected");
    wallet.signTypedData.mockResolvedValueOnce({
      signature: `0x${"ab".repeat(65)}`,
    });
    await expect(run()).rejects.toThrow("its s is too high");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
    wallet.sendTransaction.mockRejectedValueOnce(
      new Error("Transaction reverted"),
    );
    await expect(run()).rejects.toThrow("Transaction reverted");
  });
});
