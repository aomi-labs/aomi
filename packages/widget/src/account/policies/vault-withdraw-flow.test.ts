import { keccak256, recoverTypedDataAddress, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "./vault-model";
import { vaultSigner, withdrawFromVault } from "./vault-withdraw-flow";
import {
  DELEGATION_MANAGER,
  withdrawCalldata,
  withdrawSigningArgs,
  withdrawTypedData,
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

type SignPayload = {
  typed_data: Parameters<typeof owner.signTypedData>[0];
  signer: string;
  chainId: number;
  description: string;
};
const calls: string[] = [];
const wallet = {
  identity: { address: owner.address as string | undefined, chainId: 1 },
  switchChain: vi.fn(async (chainId: number) => {
    calls.push(`switch:${chainId}`);
  }),
  signTypedData: vi.fn(async (payload: SignPayload) => {
    calls.push("sign");
    return { signature: await owner.signTypedData(payload.typed_data) };
  }),
  sendTransaction: vi.fn(async (..._: unknown[]) => {
    calls.push("send");
    return { txHash: "0xsent" };
  }),
};
// The flow takes the wallet kit's own type; the fake carries what it uses.
const kit = () => wallet as unknown as Parameters<typeof withdrawFromVault>[0];
const hasCode = vi.fn(async (_chain: number, _vault: string) => {
  calls.push("code");
  return true;
});
const run = (extra: object = {}) =>
  withdrawFromVault(
    kit(),
    { hasCode },
    {
      vault,
      asset: { erc20: USDC },
      amount: BigInt(2_500_000),
      ...extra,
    },
  );

beforeEach(() => {
  calls.length = 0;
  wallet.identity = { address: owner.address, chainId: 1 };
  wallet.signTypedData.mockClear();
  wallet.sendTransaction.mockClear();
  wallet.switchChain.mockClear();
  hasCode.mockClear();
  hasCode.mockImplementation(async () => {
    calls.push("code");
    return true;
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

describe("withdrawing from the vault", () => {
  it("checks the vault, switches chain, signs the delegation, then sends the transaction it builds", async () => {
    expect(await run()).toBe("sent");
    expect(calls).toEqual(["code", "switch:8453", "sign", "send"]);
    expect(hasCode).toHaveBeenCalledWith(8453, VAULT);
    expect(wallet.switchChain).toHaveBeenCalledWith(8453);

    // It signs the typed data `withdrawTypedData` makes: a fresh salt and a
    // deadline ten minutes away, for the owner's own account.
    const [signed] = wallet.signTypedData.mock.calls[0]!;
    expect(signed.signer).toBe(owner.address);
    expect(signed.chainId).toBe(8453);
    expect(signed.description).toBe("Withdraw from your vault");
    const salt = String(
      (signed.typed_data as unknown as { message: { salt: bigint } }).message
        .salt,
    );
    expect(salt).toMatch(/^[0-9]+$/);
    const typed = withdrawTypedData({
      chainId: 8453,
      vault: VAULT,
      owner: owner.address,
      salt,
      deadline: NOW + 600,
      now: NOW,
    });
    expect(signed.typed_data).toEqual(withdrawSigningArgs(typed));
    const signer = await recoverTypedDataAddress({
      ...(signed.typed_data as Parameters<typeof recoverTypedDataAddress>[0]),
      signature: await owner.signTypedData(signed.typed_data),
    });
    expect(signer).toBe(owner.address);

    // It sends exactly the transaction `withdrawCalldata` builds from that
    // delegation and signature, to the DelegationManager, with no value.
    const expected = withdrawCalldata({
      delegation: typed.message,
      signature: await owner.signTypedData(signed.typed_data),
      asset: { erc20: USDC },
      owner: owner.address,
      amount: BigInt(2_500_000),
      now: NOW,
    });
    expect(expected.to).toBe(DELEGATION_MANAGER);
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(wallet.sendTransaction).toHaveBeenCalledWith(
      {
        requestId: "vault-withdraw",
        aaPreference: "none",
        chainId: 8453,
        to: expected.to,
        data: expected.data,
        value: "0x0",
      },
      { chainIdAlreadySelected: 8453 },
    );
  });

  it("sends the native coin the same way, as its own execution", async () => {
    await run({ asset: { native: true }, amount: BigInt("1000000000000000") });
    const [sent] = wallet.sendTransaction.mock.calls[0] as [
      { data: string; to: string; value: string },
    ];
    const [signed] = wallet.signTypedData.mock.calls[0]!;
    const typed = withdrawTypedData({
      chainId: 8453,
      vault: VAULT,
      owner: owner.address,
      salt: String(
        (signed.typed_data as unknown as { message: { salt: bigint } }).message
          .salt,
      ),
      deadline: NOW + 600,
      now: NOW,
    });
    expect(sent.data).toBe(
      withdrawCalldata({
        delegation: typed.message,
        signature: await owner.signTypedData(signed.typed_data),
        asset: { native: true },
        owner: owner.address,
        amount: BigInt("1000000000000000"),
        now: NOW,
      }).data,
    );
    expect(sent.to).toBe(DELEGATION_MANAGER);
    expect(sent.value).toBe("0x0");
  });

  it("does not switch when the wallet is on the vault's chain, and signs a new salt each time", async () => {
    wallet.identity.chainId = 8453;
    await run();
    await run();
    expect(wallet.switchChain).not.toHaveBeenCalled();
    const salts = wallet.signTypedData.mock.calls.map(([payload]) =>
      String(
        (payload.typed_data as unknown as { message: { salt: bigint } }).message
          .salt,
      ),
    );
    expect(new Set(salts).size).toBe(2);
  });

  it("asks nothing of the wallet when the vault has no code yet", async () => {
    hasCode.mockResolvedValueOnce(false);
    expect(await run()).toBe("no_vault");
    expect(calls).toEqual([]);
    expect(wallet.switchChain).not.toHaveBeenCalled();
    expect(wallet.signTypedData).not.toHaveBeenCalled();
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses another wallet than the owner's, a wallet that cannot sign or send, and an amount of zero, before anything", async () => {
    wallet.identity.address = "0x1111111111111111111111111111111111111111";
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
    await expect(
      withdrawFromVault(
        noSend as unknown as Parameters<typeof withdrawFromVault>[0],
        { hasCode },
        { vault, asset: { erc20: USDC }, amount: BigInt(1) },
      ),
    ).rejects.toThrow("This wallet can't sign that.");
    expect(hasCode).not.toHaveBeenCalled();
    expect(wallet.signTypedData).not.toHaveBeenCalled();
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("keeps the module's guards: the vault may not be the owner, and the chain must be one it covers", async () => {
    await expect(
      run({ vault: { ...vault, address: owner.address } }),
    ).rejects.toThrow("The vault and the owner must be different addresses.");
    await expect(run({ vault: { ...vault, chainId: 42161 } })).rejects.toThrow(
      "not available on this network",
    );
    expect(wallet.signTypedData).not.toHaveBeenCalled();
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("sends nothing when the owner declines to sign, and passes the wallet's error on", async () => {
    wallet.signTypedData.mockRejectedValueOnce(new Error("User rejected"));
    await expect(run()).rejects.toThrow("User rejected");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("refuses a signature the vault could not use, before sending", async () => {
    wallet.signTypedData.mockResolvedValueOnce({
      signature: `0x${"ab".repeat(65)}`,
    });
    await expect(run()).rejects.toThrow("its s is too high");
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
  });

  it("lets the wallet's own error through when the transaction fails", async () => {
    wallet.sendTransaction.mockRejectedValueOnce(
      new Error("Transaction reverted"),
    );
    await expect(run()).rejects.toThrow("Transaction reverted");
  });
});

describe("vaultSigner", () => {
  it("is the owner's own wallet, in either case", () => {
    expect(
      vaultSigner(
        {
          identity: {
            address: owner.address.toUpperCase().replace("0X", "0x"),
          },
        } as never,
        owner.address,
      ),
    ).toEqual({ canSign: true, hint: null });
  });

  it("names the wallet to connect when another is, or none is", () => {
    const hint = `Connect ${owner.address.slice(0, 6)}…${owner.address.slice(-4)} to sign.`;
    for (const address of [
      undefined,
      "0x1111111111111111111111111111111111111111",
    ])
      expect(
        vaultSigner({ identity: { address } } as never, owner.address),
      ).toEqual({ canSign: false, hint });
  });
});
