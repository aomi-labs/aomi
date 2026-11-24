import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AomiPolicyEnforcement,
  AomiPolicySigner,
} from "@aomi-labs/client";
import { failureText, useRuleEnforcement } from "./policy-enforcement";

const kit = vi.hoisted(() => ({
  identity: {
    address: "0xAbCd00000000000000000000000000000000Ef12" as string | undefined,
    svmAddress: undefined as string | undefined,
    chainId: 8453,
  },
  switchChain: vi.fn(async (_: number) => undefined),
  sendTransaction: vi.fn(async (..._: unknown[]) => ({ txHash: "0xsent" })),
}));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => kit }));

describe("the connected wallet as the SDK's policy signer", () => {
  const OWNER = "0xAbCd00000000000000000000000000000000Ef12";
  const entry = {
    rule: "eip155:8453/native@any",
    provider: "metamask",
    network: "eip155:8453",
    ready: true,
    note: "Your revocation is signed. Send it from your wallet.",
    signer: { family: "evm", address: OWNER },
  } as AomiPolicyEnforcement;
  beforeEach(() => {
    kit.identity.address = OWNER;
    kit.identity.chainId = 1;
    kit.switchChain.mockClear();
    kit.sendTransaction.mockClear();
  });
  async function run(enforce: (signer: AomiPolicySigner) => Promise<void>) {
    const client = {
      account: {
        policy: {
          enforce: vi.fn(async (...args: unknown[]) => {
            await enforce(args[2] as AomiPolicySigner);
            return { policies: { enforcement: [] }, settled: true };
          }),
        },
      },
    };
    const { result } = renderHook(() =>
      useRuleEnforcement({
        client: client as never,
        walletId: "w",
        revision: 1,
        onRules: vi.fn(),
        onStale: vi.fn(),
      }),
    );
    await act(async () => {
      result.current.takeOff(entry, "Take it off").run();
    });
    await waitFor(() => expect(result.current.takeOff(entry).busy).toBe(false));
    return { error: result.current.takeOff(entry).error, ...client.account };
  }

  it("switches to the chain and sends a plain transaction from the connected account", async () => {
    const { error, policy } = await run(async (signer) => {
      expect(signer.evmAddress).toBe(OWNER);
      await signer.sendEvmTransaction!({
        chainId: 8453,
        to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
        data: "0xcafe",
        value: "0x0",
      });
    });
    expect(error).toBeNull();
    expect(policy.enforce).toHaveBeenCalledWith(
      "w",
      entry,
      expect.anything(),
      expect.objectContaining({ revision: 1, owner: OWNER, remove: true }),
    );
    expect(kit.switchChain).toHaveBeenCalledWith(8453);
    expect(kit.sendTransaction).toHaveBeenCalledWith(
      {
        requestId: "policy-revocation",
        aaPreference: "none",
        chainId: 8453,
        to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
        data: "0xcafe",
        value: "0x0",
      },
      { chainIdAlreadySelected: 8453 },
    );
  });

  it("shows what the SDK refused", async () => {
    const { error } = await run(async () => {
      throw new Error("Aomi asked to send funds with the revocation.");
    });
    expect(error).toMatch(/send funds/);
    expect(kit.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("a step the connected wallet cannot take is disabled, with the reason", () => {
  const OWNER = "0xAbCd00000000000000000000000000000000Ef12";
  const SOL = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
  const SENT = "Your revocation is signed. Send it from your wallet.";
  const evm = { family: "evm", address: OWNER };
  const svm = { family: "svm", address: SOL };
  const sign = vi.fn();
  const NO_SOLANA =
    "This wallet can’t sign Solana transactions here. Connect another Solana wallet to deploy.";
  it.each([
    [
      "Swig deploy, direct send",
      svm,
      false,
      { signAndSendSolanaTransaction: sign },
      null,
    ],
    [
      "Swig deploy, sign then broadcast",
      svm,
      false,
      { signSolanaTransaction: sign, solanaRpcHttpUrl: "https://rpc" },
      null,
    ],
    [
      "Swig deploy, signing with no RPC",
      svm,
      false,
      { signSolanaTransaction: sign },
      NO_SOLANA,
    ],
    ["Swig deploy, no Solana path", svm, false, {}, NO_SOLANA],
    ["MetaMask deploy", evm, false, { signTypedData: sign }, null],
    [
      "MetaMask deploy, no typed data",
      evm,
      false,
      {},
      "This wallet can’t sign this policy here. Connect another EVM wallet to deploy.",
    ],
    ["MetaMask revoke", evm, true, { sendTransaction: sign }, null],
    [
      "MetaMask revoke, no send",
      evm,
      true,
      { signTypedData: sign },
      "This wallet can’t send transactions here. Connect another EVM wallet to send it.",
    ],
    [
      "another EVM wallet connected",
      evm,
      false,
      {
        identity: { address: "0x1111000000000000000000000000000000002222" },
        signTypedData: sign,
      },
      "Only the wallet that set this policy can change it on chain. Connect 0xAbCd…Ef12 to sign.",
    ],
    [
      "no wallet, no owner yet",
      { family: "svm" },
      false,
      { identity: { svmAddress: undefined } },
      "Connect a Solana wallet to sign.",
    ],
  ])("%s", (_, signer, remove, wallet, hint) => {
    const { identity, ...methods } = {
      identity: {},
      sendTransaction: undefined,
      ...wallet,
    };
    Object.assign(kit, methods, {
      identity: { address: OWNER, svmAddress: SOL, chainId: 8453, ...identity },
    });
    const entry = {
      rule: "r",
      provider: "p",
      network: "n",
      ready: true,
      note: remove ? SENT : null,
      signer,
    } as AomiPolicyEnforcement;
    const { result } = renderHook(() =>
      useRuleEnforcement({
        client: {} as never,
        walletId: "w",
        revision: 1,
        onRules: vi.fn(),
        onStale: vi.fn(),
      }),
    );
    const step = result.current[remove ? "takeOff" : "step"](entry);
    expect(step).toMatchObject({ disabled: hint !== null, hint });
    for (const key of Object.keys(methods))
      delete (kit as Record<string, unknown>)[key];
    kit.sendTransaction = vi.fn(async () => ({ txHash: "0xsent" }));
  });
});

describe("failureText", () => {
  it("names a Solana adapter error that has no message", () => {
    const cause = new Error("");
    cause.name = "WalletNotSelectedError";
    expect(failureText(cause)).toMatch(/No Solana wallet is connected/);
    expect(failureText(new Error(""))).toBe("");
  });

  it("reads the message of an Error, a string and a plain wallet object", () => {
    expect(failureText(new Error("boom"))).toBe("boom");
    expect(failureText("nope")).toBe("nope");
    expect(failureText({ shortMessage: "short", message: "long" })).toBe(
      "short",
    );
    expect(failureText({ details: "from the node" })).toBe("from the node");
    expect(failureText(undefined)).toBe("");
  });

  it("explains a block the wallet's Solana network does not know", () => {
    expect(failureText({ message: "Blockhash not found" })).toMatch(
      /same network as Aomi/,
    );
  });
});
