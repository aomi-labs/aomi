import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "./vault-model";
import { vaultSigner, withdrawFromVault } from "./vault-withdraw-flow";
import {
  DELEGATION_MANAGER,
  withdrawCalldata,
  withdrawSigningArgs,
  withdrawTypedData,
  type WithdrawAsset,
} from "./vault-withdraw";

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

const calls: string[] = [];
const wallet = {
  identity: { address: owner.address as string | undefined, chainId: 1 },
  switchChain: vi.fn(async (chainId: number) => {
    calls.push(`switch:${chainId}`);
  }),
  signTypedData: vi.fn(async (payload: { typed_data: Typed }) => {
    calls.push("sign");
    return { signature: await owner.signTypedData(payload.typed_data) };
  }),
  sendTransaction: vi.fn(async (..._: unknown[]) => {
    calls.push("send");
    return { txHash: "0xsent" };
  }),
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
const saltOf = (call = 0) =>
  String(
    (
      wallet.signTypedData.mock.calls[call]![0].typed_data as unknown as {
        message: { salt: unknown };
      }
    ).message.salt,
  );
const expectNothingSigned = () => {
  expect(wallet.signTypedData).not.toHaveBeenCalled();
  expect(wallet.sendTransaction).not.toHaveBeenCalled();
};

beforeEach(() => {
  calls.length = 0;
  wallet.identity = { address: owner.address, chainId: 1 };
  vi.clearAllMocks();
  hasCode.mockImplementation(async () => {
    calls.push("code");
    return true;
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

describe("withdrawing from the vault", () => {
  it.each<[WithdrawAsset, bigint]>([
    [{ erc20: USDC }, BigInt(2_500_000)],
    [{ native: true }, BigInt("1000000000000000")],
  ])(
    "checks the vault, switches chain, signs the owner's delegation, then sends the calldata it builds for %j",
    async (asset, amount) => {
      expect(await run({ asset, amount })).toBe("sent");
      expect(calls).toEqual(["code", "switch:8453", "sign", "send"]);
      expect(hasCode).toHaveBeenCalledWith(8453, VAULT);

      // A fresh salt and a deadline ten minutes away, for the owner's own account.
      const [signed] = wallet.signTypedData.mock.calls[0]!;
      expect(signed).toMatchObject({
        signer: owner.address,
        chainId: 8453,
        description: "Withdraw from your vault",
      });
      expect(saltOf()).toMatch(/^[0-9]+$/);
      const typed = withdrawTypedData({
        chainId: 8453,
        vault: VAULT,
        owner: owner.address,
        salt: saltOf(),
        deadline: NOW + 600,
        now: NOW,
      });
      expect(signed.typed_data).toEqual(withdrawSigningArgs(typed));

      const { to, data } = withdrawCalldata({
        delegation: typed.message,
        signature: await owner.signTypedData(signed.typed_data),
        asset,
        owner: owner.address,
        amount,
        now: NOW,
      });
      expect(to).toBe(DELEGATION_MANAGER);
      expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
      expect(wallet.sendTransaction).toHaveBeenCalledWith(
        {
          requestId: "vault-withdraw",
          aaPreference: "none",
          chainId: 8453,
          to,
          data,
          value: "0x0",
        },
        { chainIdAlreadySelected: 8453 },
      );
    },
  );

  it("does not switch when the wallet is on the vault's chain, and signs a new salt each time", async () => {
    wallet.identity.chainId = 8453;
    await run();
    await run();
    expect(wallet.switchChain).not.toHaveBeenCalled();
    expect(saltOf(0)).not.toBe(saltOf(1));
  });

  it("asks nothing of the wallet when the vault has no code yet", async () => {
    hasCode.mockResolvedValueOnce(false);
    expect(await run()).toBe("no_vault");
    expect(calls).toEqual([]);
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

  it("keeps the module's guards: the vault may not be the owner, and the chain must be covered", async () => {
    await expect(
      run({ vault: { ...vault, address: owner.address } }),
    ).rejects.toThrow("The vault and the owner must be different addresses.");
    await expect(run({ vault: { ...vault, chainId: 42161 } })).rejects.toThrow(
      "not available on this network",
    );
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

describe("vaultSigner", () => {
  it("is the owner's wallet in either case, else names the wallet to connect", () => {
    const signer = (address?: string) =>
      vaultSigner({ identity: { address } } as never, owner.address);
    expect(signer(owner.address.toUpperCase().replace("0X", "0x"))).toEqual({
      canSign: true,
      hint: null,
    });
    const hint = `Connect ${owner.address.slice(0, 6)}…${owner.address.slice(-4)} to sign.`;
    for (const address of [undefined, `0x${"1".repeat(40)}`])
      expect(signer(address)).toEqual({ canSign: false, hint });
  });
});
