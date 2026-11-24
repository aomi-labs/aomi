import { describe, expect, it, vi } from "vitest";
import type {
  AomiPolicyAction,
  AomiPolicyEnforcement,
  AomiPolicyTypedData,
} from "./policy";
import { AomiApiError } from "../api-error";
import {
  enforcePolicy,
  signableTypedData,
  type AomiPolicySigner,
} from "./policy-enforce";

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

describe("a transaction that was sent and the backend's node never shows", () => {
  const SOLANA_OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4x";
  const entry = {
    rule: "solana:mainnet-beta/native@any",
    provider: "swig",
    network: "solana:mainnet-beta",
    ready: true,
    note: null,
    signer: { family: "svm", address: SOLANA_OWNER },
  } as AomiPolicyEnforcement;
  const unsettled = () =>
    new AomiApiError(409, "chain_not_settled", "not settled");
  const flow = (
    action: AomiPolicyAction | null,
    confirm: () => Promise<unknown>,
    signer: AomiPolicySigner,
    held = entry,
  ) => {
    const transport = {
      get: vi.fn(async () => ({ enforcement: [], revision: 2 })),
      prepareEnforcement: vi.fn(async () => action),
      confirmEnforcement: vi.fn(confirm),
    };
    const result = enforcePolicy(transport as never, "w", held, signer, {
      revision: 1,
      owner: held.signer.address!,
      retryDelayMs: 0,
    });
    return { transport, result };
  };
  const transaction: AomiPolicyAction = {
    kind: "transaction",
    network: "solana:mainnet-beta",
    unsigned_base64: "dW5zaWduZWQ=",
  };
  const sendSolanaTransaction = async () => "5igSent";

  it("answers the signature with settled false and the policies as they stand, after the same retries", async () => {
    const { transport, result } = flow(
      transaction,
      async () => {
        throw unsettled();
      },
      { sendSolanaTransaction },
    );
    await expect(result).resolves.toEqual({
      policies: { enforcement: [], revision: 2 },
      settled: false,
      transaction: "5igSent",
    });
    expect(transport.confirmEnforcement).toHaveBeenCalledTimes(6);
    expect(transport.get).toHaveBeenCalledWith("w");
  });

  it("answers the signature once it settles, and reads nothing more", async () => {
    let calls = 0;
    const { transport, result } = flow(
      transaction,
      async () => {
        if ((calls += 1) < 3) throw unsettled();
        return { enforcement: [], revision: 3 };
      },
      { sendSolanaTransaction },
    );
    await expect(result).resolves.toEqual({
      policies: { enforcement: [], revision: 3 },
      settled: true,
      transaction: "5igSent",
    });
    expect(transport.get).not.toHaveBeenCalled();
  });

  it("still throws when nothing was sent, and any other refusal", async () => {
    const nothing = flow(
      null,
      async () => {
        throw unsettled();
      },
      {},
    );
    await expect(nothing.result).rejects.toMatchObject({
      code: "chain_not_settled",
    });
    expect(nothing.transport.get).not.toHaveBeenCalled();
    const refusedAfterSend = flow(
      transaction,
      async () => {
        throw new AomiApiError(409, "rules_changed", "changed");
      },
      { sendSolanaTransaction },
    );
    await expect(refusedAfterSend.result).rejects.toMatchObject({
      code: "rules_changed",
    });
    expect(refusedAfterSend.transport.confirmEnforcement).toHaveBeenCalledTimes(
      1,
    );
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
  const sendEvmTransaction = vi.fn(async () => undefined);
  async function run(
    answer: AomiPolicyAction,
    held = entry(),
    signer: AomiPolicySigner = { evmAddress: OWNER, sendEvmTransaction },
  ) {
    sendEvmTransaction.mockClear();
    const confirmEnforcement = vi.fn(async () => ({ enforcement: [] }));
    const transport = {
      prepareEnforcement: vi.fn(async () => answer),
      confirmEnforcement,
    };
    const error = await enforcePolicy(transport as never, "w", held, signer, {
      revision: 1,
      owner: OWNER,
      remove: true,
    }).then(
      () => null,
      (cause: Error) => cause.message,
    );
    return { error, confirmEnforcement, transport };
  }

  it("sends nothing to an address it cannot read, to an ENS name, or with value", async () => {
    for (const [change, message] of [
      [{ to: "0x1234" }, /not an address/],
      [{ to: "vitalik.eth" }, /not an address/],
      [{ to: "0xdb9b1e94b5b69df7e401ddbede43491141047dbz" }, /not an address/],
      [{ value: "0x1" }, /send funds/],
      [{ to: "0x00000000000000000000000000000000000000aa" }, /manager/],
      [{ network: "eip155:1" }, /another network/],
    ] as const) {
      const { error, confirmEnforcement } = await run(action(change));
      expect(error).toMatch(message);
      expect(confirmEnforcement).not.toHaveBeenCalled();
      expect(sendEvmTransaction).not.toHaveBeenCalled();
    }
  });

  it("sends nothing from another account than the owner's, or for a Solana signer", async () => {
    const other = await run(action(), entry(), {
      evmAddress: "0x1111000000000000000000000000000000002222",
      sendEvmTransaction,
    });
    expect(other.error).toMatch(/wallet that owns the policy/);
    expect(other.confirmEnforcement).not.toHaveBeenCalled();
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
    expect(sendEvmTransaction).not.toHaveBeenCalled();
  });

  describe("a deployment sent as a transaction", () => {
    // The vault's creation: the entry asks for a transaction until the
    // backend's node shows it.
    const asks = entry({ state: "off", note: null, next: "evm_transaction" });
    const deploy = async (confirmed: object[], held = asks) => {
      let calls = 0;
      const transport = {
        prepareEnforcement: vi.fn(async () => action()),
        confirmEnforcement: vi.fn(async () => ({
          enforcement: [confirmed[Math.min(calls++, confirmed.length - 1)]],
        })),
      };
      const result = await enforcePolicy(
        transport as never,
        "w",
        held,
        { evmAddress: OWNER, sendEvmTransaction: async () => "0xhash" },
        { revision: 1, owner: OWNER, retryDelayMs: 0 },
      );
      return { result, confirms: transport.confirmEnforcement.mock.calls };
    };

    it("keeps confirming while the entry is unchanged, and settles once it moves on", async () => {
      const moved = { ...asks, next: "typed_data" };
      const { result, confirms } = await deploy([asks, asks, moved]);
      expect(result).toEqual({
        policies: { enforcement: [moved] },
        settled: true,
        transaction: "0xhash",
      });
      expect(confirms).toHaveLength(3);
    });

    it("answers settled false and keeps the transaction when it never moves on", async () => {
      const { result, confirms } = await deploy([asks]);
      expect(result).toMatchObject({ settled: false, transaction: "0xhash" });
      expect(confirms).toHaveLength(6);
    });

    it("settles at once, as before, for a backend that sends no next", async () => {
      const old = entry({ state: "off", note: null });
      const { result, confirms } = await deploy([old], old);
      expect(result.settled).toBe(true);
      expect(confirms).toHaveLength(1);
    });
  });

  it("sends the prepared transaction from the owner's wallet and nothing else", async () => {
    const { error, confirmEnforcement, transport } = await run(action());
    expect(error).toBeNull();
    const request = {
      network: "eip155:8453",
      rule: "eip155:8453/native@any",
      revision: 1,
      owner: OWNER,
      remove: true,
    };
    expect(transport.prepareEnforcement).toHaveBeenCalledWith(
      "w",
      "metamask",
      request,
    );
    expect(sendEvmTransaction).toHaveBeenCalledWith({
      chainId: 8453,
      to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
      data: "0xcafe",
      value: "0x0",
    });
    expect(confirmEnforcement).toHaveBeenCalledTimes(1);
    expect(confirmEnforcement).toHaveBeenCalledWith("w", "metamask", request);
  });
});
