import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AomiPolicyAction,
  AomiPolicyEnforcement,
  AomiPolicyTypedData,
} from "@aomi-labs/client";
import {
  failureText,
  signableTypedData,
  useRuleEnforcement,
} from "./policy-enforcement";

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

const data = (overrides: Partial<AomiPolicyTypedData> = {}) =>
  ({
    domain: { name: "Delegation", chainId: "8453", salt: "0x01" },
    types: {
      Delegation: [
        { name: "delegate", type: "address" },
        { name: "cap", type: "uint256" },
        { name: "nonce", type: "uint64" },
        { name: "delta", type: "int256" },
        { name: "caveats", type: "Caveat[]" },
        { name: "memo", type: "string" },
      ],
      Caveat: [
        { name: "limit", type: "uint256" },
        { name: "tags", type: "uint8[]" },
      ],
    },
    primaryType: "Delegation",
    message: {
      delegate: "0x00000000000000000000000000000000000000aa",
      cap: "123456789012345678901234567890",
      nonce: 7,
      delta: "-5",
      caveats: [{ limit: "9007199254740993", tags: ["1", "0x02"] }],
      // A string field that looks like a number stays text.
      memo: "42",
    },
    ...overrides,
  }) satisfies AomiPolicyTypedData;

describe("typed data the backend asks the owner to sign", () => {
  it("reads every declared integer as a bigint, in structs and arrays, and the domain's chain id as a number", () => {
    const signable = signableTypedData(data(), 8453);
    expect(signable.domain).toEqual({
      name: "Delegation",
      chainId: 8453,
      salt: "0x01",
    });
    expect(signable.message).toEqual({
      delegate: "0x00000000000000000000000000000000000000aa",
      cap: BigInt("123456789012345678901234567890"),
      nonce: BigInt(7),
      delta: BigInt(-5),
      caveats: [
        { limit: BigInt("9007199254740993"), tags: [BigInt(1), BigInt(2)] },
      ],
      memo: "42",
    });
    expect(signable.primaryType).toBe("Delegation");
  });

  const sent = (message: Record<string, unknown>) =>
    data({ message: { ...data().message, ...message } });
  it.each([
    [
      { cap: 1.2345678901234568e29 },
      /number this wallet can't read \(message\.cap\)/,
    ],
    [{ cap: "12.5" }, /message\.cap/],
    [
      { caveats: [{ limit: "1", tags: ["x"] }] },
      /message\.caveats\[0\]\.tags\[0\]/,
    ],
    [{ caveats: "none" }, /message\.caveats/],
  ])("refuses a rounded number or non-numeric text (%#)", (message, error) => {
    expect(() => signableTypedData(sent(message), 8453)).toThrow(error);
  });

  it("refuses a domain for another chain, and a primary type it does not define", () => {
    expect(() => signableTypedData(data(), 10)).toThrow(
      "The data to sign is for another chain than this policy's.",
    );
    expect(() =>
      signableTypedData(data({ primaryType: "Permit" }), 8453),
    ).toThrow("The data to sign names a type it does not define.");
    // A domain without a chain id is signed as it is.
    const open = data({ domain: { name: "Delegation" } });
    expect(signableTypedData(open, 8453).domain).toEqual(open.domain);
  });
});

describe("sending the owner's signed revocation, whatever the client parsed", () => {
  const OWNER = "0xAbCd00000000000000000000000000000000Ef12";
  const entry = (extra: object = {}): AomiPolicyEnforcement => ({
    rule: "eip155:8453/native@any",
    provider: "metamask",
    name: "MetaMask",
    network: "eip155:8453",
    state: "behind",
    ready: true,
    left: "1",
    expires_at: null,
    account: null,
    deployment_tx: null,
    note: "Your revocation is signed. Send it from your wallet to take the grant off chain.",
    signer: { family: "evm", address: OWNER },
    ...extra,
  });
  const action = (extra: object = {}): AomiPolicyAction => ({
    kind: "evm_transaction",
    network: "eip155:8453",
    to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
    data: "0xcafe",
    value: "0x0",
    ...extra,
  });
  beforeEach(() => {
    kit.identity.address = OWNER;
    kit.identity.chainId = 8453;
    kit.switchChain.mockClear();
    kit.sendTransaction.mockClear();
  });
  async function run(answer: AomiPolicyAction, held = entry()) {
    const confirmEnforcement = vi.fn(async () => ({ enforcement: [] }));
    const client = {
      account: {
        rules: {
          prepareEnforcement: vi.fn(async () => answer),
          confirmEnforcement,
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
      result.current.takeOff(held, "Take it off").run();
    });
    await waitFor(() => expect(result.current.takeOff(held).busy).toBe(false));
    return { error: result.current.takeOff(held).error, confirmEnforcement };
  }

  it("sends nothing to an address it cannot read, to an ENS name, or with value", async () => {
    for (const [change, message] of [
      [{ to: "0x1234" }, /not an address/],
      [{ to: "vitalik.eth" }, /not an address/],
      [{ to: "0xdb9b1e94b5b69df7e401ddbede43491141047dbz" }, /not an address/],
      [{ value: "0x1" }, /send funds/],
    ] as const) {
      const { error, confirmEnforcement } = await run(action(change));
      expect(error).toMatch(message);
      expect(confirmEnforcement).not.toHaveBeenCalled();
    }
    expect(kit.sendTransaction).not.toHaveBeenCalled();
  });

  it("sends nothing from another account than the owner's, or for a Solana signer", async () => {
    kit.identity.address = "0x1111000000000000000000000000000000002222";
    const other = await run(action());
    expect(other.error).toMatch(/wallet that owns the policy/);
    expect(other.confirmEnforcement).not.toHaveBeenCalled();
    kit.identity.address = OWNER;
    const solana = await run(
      action(),
      entry({
        signer: {
          family: "svm",
          address: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4x",
        },
      }),
    );
    expect(solana.error).toBe("This wallet can't send that.");
    expect(solana.confirmEnforcement).not.toHaveBeenCalled();
    expect(kit.sendTransaction).not.toHaveBeenCalled();
  });

  it("sends the prepared transaction from the owner's wallet and nothing else", async () => {
    kit.identity.chainId = 1;
    const { error, confirmEnforcement } = await run(action());
    expect(error).toBeNull();
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
    expect(confirmEnforcement).toHaveBeenCalledTimes(1);
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
