import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, type Hex } from "viem";

import {
  CallVerificationError,
  ExpectedCalls,
  type Action,
  type ActionRequest,
  type SignableCommit,
} from "./";

const anchorAbi = parseAbi([
  "function registerRoot(bytes32 root)",
  "function revokeRoot(bytes32 root)",
  "function registerBatch(bytes32[] roots, (address owner, uint64 epoch) meta)",
]);
const tokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const ANCHOR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const ROOT: Hex =
  "0x9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658";
const OTHER_ROOT: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const registerRoot = (root: Hex = ROOT) =>
  encodeFunctionData({
    abi: anchorAbi,
    functionName: "registerRoot",
    args: [root],
  });

function evmRequest(
  transactions: { to: string; data: string; value?: string; chain?: number }[],
  status: "passed" | "failed" | "unavailable" = "passed",
): ActionRequest {
  return {
    type: "execute_evm",
    transactions: transactions.map((transaction) => ({
      chain_id: transaction.chain ?? 31337,
      from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      label: "Register root",
      kind: "contract_call",
    })),
    simulation: {
      status,
      balanceChanges: [],
      approvals: [],
      fees: [],
      warnings: [],
      guards: [],
      gas: null,
      logs: [],
    },
  };
}

const expectRoot = new ExpectedCalls({
  chainId: 31337,
  to: ANCHOR,
  abi: anchorAbi,
  functionName: "registerRoot",
  args: [ROOT],
});

describe("ExpectedCalls", () => {
  it("accepts a matching execute_evm request and returns decoded calls", () => {
    const verification = expectRoot.verify(
      evmRequest([{ to: ANCHOR.toLowerCase(), data: registerRoot() }]),
    );
    expect(verification).toMatchObject({
      ok: true,
      simulation: "passed",
      mismatches: [],
    });
    expect(verification.calls).toEqual([
      {
        chainId: 31337,
        to: ANCHOR.toLowerCase(),
        value: 0n,
        data: registerRoot(),
        functionName: "registerRoot",
        args: [ROOT],
      },
    ]);
  });

  it("unwraps an Action and compares bytes case-insensitively", () => {
    const action = {
      type: "action",
      event_id: "event",
      sequence: 1,
      turn_id: null,
      occurred_at: 0,
      id: "action-1",
      revision: 0,
      state: "pending",
      request: evmRequest([{ to: ANCHOR, data: registerRoot() }]),
      created_at: 0,
      expires_at: null,
    } satisfies Action;
    const expected = new ExpectedCalls({
      to: ANCHOR.toUpperCase().replace("0X", "0x"),
      abi: anchorAbi,
      functionName: "registerRoot",
      args: [ROOT.toUpperCase().replace("0X", "0x")],
    });
    expect(expected.assert(action)).toHaveLength(1);
  });

  it("reports a wrong target contract", () => {
    const verification = expectRoot.verify(
      evmRequest([{ to: TOKEN, data: registerRoot() }]),
    );
    expect(verification.ok).toBe(false);
    expect(verification.mismatches).toEqual([
      expect.objectContaining({
        call: 0,
        field: "to",
        expected: ANCHOR,
        actual: TOKEN,
      }),
    ]);
  });

  it("reports a wrong function in the same ABI", () => {
    const data = encodeFunctionData({
      abi: anchorAbi,
      functionName: "revokeRoot",
      args: [ROOT],
    });
    const verification = expectRoot.verify(evmRequest([{ to: ANCHOR, data }]));
    expect(verification.mismatches).toEqual([
      expect.objectContaining({
        field: "function",
        expected: "registerRoot",
        actual: "revokeRoot",
      }),
    ]);
    expect(verification.calls[0].functionName).toBe("revokeRoot");
  });

  it("reports a selector outside the expected ABI", () => {
    const data = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [TOKEN, 2n ** 256n - 1n],
    });
    const verification = expectRoot.verify(evmRequest([{ to: ANCHOR, data }]));
    expect(verification.mismatches).toEqual([
      expect.objectContaining({
        field: "function",
        actual: data.slice(0, 10),
      }),
    ]);
  });

  it("reports wrong arguments with the argument index", () => {
    const verification = expectRoot.verify(
      evmRequest([{ to: ANCHOR, data: registerRoot(OTHER_ROOT) }]),
    );
    expect(verification.mismatches).toEqual([
      expect.objectContaining({
        call: 0,
        field: "args",
        argIndex: 0,
        expected: ROOT,
        actual: OTHER_ROOT,
      }),
    ]);
    expect(verification.mismatches[0].message).toContain("argument root");
  });

  it("reports an expected argument that is not valid for the ABI type", () => {
    const expected = new ExpectedCalls({
      to: ANCHOR,
      abi: anchorAbi,
      functionName: "registerRoot",
      args: ["not-bytes32"],
    });
    const verification = expected.verify(
      evmRequest([{ to: ANCHOR, data: registerRoot() }]),
    );
    expect(verification.mismatches[0]).toMatchObject({
      field: "args",
      argIndex: 0,
    });
    expect(verification.mismatches[0].message).toContain(
      "is not a valid bytes32",
    );
  });

  it("compares bigint, number, and address arguments by ABI encoding", () => {
    const amount = 10n ** 30n;
    const data = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [ANCHOR, amount],
    });
    const matching = new ExpectedCalls({
      to: TOKEN,
      abi: tokenAbi,
      functionName: "approve",
      args: [ANCHOR.toLowerCase(), amount],
    });
    expect(matching.verify(evmRequest([{ to: TOKEN, data }])).ok).toBe(true);

    const small = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [ANCHOR, 5n],
    });
    const asNumber = new ExpectedCalls({
      to: TOKEN,
      abi: tokenAbi,
      functionName: "approve",
      args: [ANCHOR, 5],
    });
    expect(asNumber.verify(evmRequest([{ to: TOKEN, data: small }])).ok).toBe(
      true,
    );

    const offByOne = new ExpectedCalls({
      to: TOKEN,
      abi: tokenAbi,
      functionName: "approve",
      args: [ANCHOR, amount - 1n],
    });
    const verification = offByOne.verify(evmRequest([{ to: TOKEN, data }]));
    expect(verification.mismatches).toEqual([
      expect.objectContaining({
        field: "args",
        argIndex: 1,
        expected: amount - 1n,
        actual: amount,
      }),
    ]);
    expect(verification.mismatches[0].message).toContain(
      "1000000000000000000000000000000",
    );
  });

  it("compares array and struct arguments", () => {
    const meta = { owner: ANCHOR, epoch: 7n } as const;
    const data = encodeFunctionData({
      abi: anchorAbi,
      functionName: "registerBatch",
      args: [[ROOT, OTHER_ROOT], meta],
    });
    const call = {
      to: ANCHOR,
      abi: anchorAbi,
      functionName: "registerBatch",
    };
    expect(
      new ExpectedCalls({
        ...call,
        args: [[ROOT, OTHER_ROOT], { owner: ANCHOR.toLowerCase(), epoch: 7 }],
      }).verify(evmRequest([{ to: ANCHOR, data }])).ok,
    ).toBe(true);
    expect(
      new ExpectedCalls({
        ...call,
        args: [[OTHER_ROOT, ROOT], meta],
      }).verify(evmRequest([{ to: ANCHOR, data }])).mismatches,
    ).toEqual([expect.objectContaining({ field: "args", argIndex: 0 })]);
  });

  it("reports an argument count mismatch", () => {
    const expected = new ExpectedCalls({
      to: ANCHOR,
      abi: anchorAbi,
      functionName: "registerRoot",
    });
    expect(
      expected.verify(evmRequest([{ to: ANCHOR, data: registerRoot() }]))
        .mismatches,
    ).toEqual([
      expect.objectContaining({ field: "args", expected: [], actual: [ROOT] }),
    ]);
  });

  it("rejects calldata with trailing bytes", () => {
    const verification = expectRoot.verify(
      evmRequest([{ to: ANCHOR, data: `${registerRoot()}deadbeef` }]),
    );
    expect(verification.mismatches).toEqual([
      expect.objectContaining({ field: "data" }),
    ]);
  });

  it("requires zero value unless a value is expected", () => {
    const paid = evmRequest([
      { to: ANCHOR, data: registerRoot(), value: "1000" },
    ]);
    expect(expectRoot.verify(paid).mismatches).toEqual([
      expect.objectContaining({ field: "value", expected: 0n, actual: 1000n }),
    ]);
    const withValue = new ExpectedCalls({
      to: ANCHOR,
      abi: anchorAbi,
      functionName: "registerRoot",
      args: [ROOT],
      value: 1000n,
    });
    expect(withValue.verify(paid).ok).toBe(true);
    expect(
      withValue.verify(
        evmRequest([{ to: ANCHOR, data: registerRoot(), value: "0x3e8" }]),
      ).ok,
    ).toBe(true);
  });

  it("reports an invalid expected value through the verification contract", () => {
    const invalid = new ExpectedCalls({
      to: ANCHOR,
      abi: anchorAbi,
      functionName: "registerRoot",
      args: [ROOT],
      value: "not-wei",
    });
    const request = evmRequest([{ to: ANCHOR, data: registerRoot() }]);

    expect(invalid.verify(request).mismatches).toEqual([
      expect.objectContaining({ field: "value", expected: "not-wei" }),
    ]);
    expect(() => invalid.assert(request)).toThrow(CallVerificationError);
  });

  it("checks the chain when one is expected", () => {
    expect(
      expectRoot.verify(
        evmRequest([{ to: ANCHOR, data: registerRoot(), chain: 1 }]),
      ).mismatches,
    ).toEqual([
      expect.objectContaining({ field: "chainId", expected: 31337, actual: 1 }),
    ]);
  });

  it("rejects failed simulation even when everything else matches", () => {
    const verification = expectRoot.verify(
      evmRequest([{ to: ANCHOR, data: registerRoot() }], "failed"),
    );
    expect(verification.simulation).toBe("failed");
    expect(verification.mismatches).toEqual([
      expect.objectContaining({
        call: null,
        field: "simulation",
        actual: "failed",
      }),
    ]);
    const lenient = new ExpectedCalls(expectRoot.calls, {
      allowUnavailableSimulation: true,
    });
    expect(
      lenient.verify(
        evmRequest([{ to: ANCHOR, data: registerRoot() }], "failed"),
      ).ok,
    ).toBe(false);
  });

  it("allows unavailable simulation only when opted in", () => {
    const request = evmRequest(
      [{ to: ANCHOR, data: registerRoot() }],
      "unavailable",
    );
    expect(expectRoot.verify(request).mismatches).toEqual([
      expect.objectContaining({ field: "simulation", actual: "unavailable" }),
    ]);
    expect(
      new ExpectedCalls(expectRoot.calls, {
        allowUnavailableSimulation: true,
      }).verify(request).ok,
    ).toBe(true);
  });

  it("verifies multiple transactions positionally", () => {
    const approve = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [ANCHOR, 100n],
    });
    const expected = new ExpectedCalls([
      {
        to: TOKEN,
        abi: tokenAbi,
        functionName: "approve",
        args: [ANCHOR, 100n],
      },
      {
        to: ANCHOR,
        abi: anchorAbi,
        functionName: "registerRoot",
        args: [ROOT],
      },
    ]);
    const ordered = evmRequest([
      { to: TOKEN, data: approve },
      { to: ANCHOR, data: registerRoot() },
    ]);
    expect(expected.assert(ordered).map((call) => call.functionName)).toEqual([
      "approve",
      "registerRoot",
    ]);

    const swapped = expected.verify(
      evmRequest([
        { to: ANCHOR, data: registerRoot() },
        { to: TOKEN, data: approve },
      ]),
    );
    expect(swapped.mismatches.map((mismatch) => mismatch.call)).toEqual([
      0, 0, 1, 1,
    ]);
  });

  it("reports extra and missing transactions", () => {
    const extra = expectRoot.verify(
      evmRequest([
        { to: ANCHOR, data: registerRoot() },
        { to: ANCHOR, data: registerRoot(OTHER_ROOT) },
      ]),
    );
    expect(extra.mismatches).toEqual([
      expect.objectContaining({ field: "count", expected: 1, actual: 2 }),
    ]);
    expect(extra.calls[1]).not.toHaveProperty("functionName");

    const missing = new ExpectedCalls([
      expectRoot.calls[0],
      expectRoot.calls[0],
    ]).verify(evmRequest([{ to: ANCHOR, data: registerRoot() }]));
    expect(missing.mismatches).toEqual([
      expect.objectContaining({ field: "count", expected: 2, actual: 1 }),
    ]);
  });

  it("verifies the exact EVM SignableCommit a wallet signs", () => {
    const payload: SignableCommit = {
      kind: "evm_transaction",
      chain_id: 31337,
      signer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      nonce: 3,
      transaction: {
        to: ANCHOR,
        value: "0",
        data: registerRoot(),
        gas_limit: 60_000,
        max_fee_per_gas: "2000000000",
        max_priority_fee_per_gas: "1000000000",
      },
    };
    expect(expectRoot.verify(payload)).toMatchObject({
      ok: true,
      simulation: null,
    });
    expect(
      expectRoot.verify({
        ...payload,
        transaction: { ...payload.transaction, data: registerRoot(OTHER_ROOT) },
      }).ok,
    ).toBe(false);
  });

  it("verifies EVM sign request calls and their safety simulation status", () => {
    const request: ActionRequest = {
      type: "sign",
      requestId: "user-op",
      chainFamily: "evm",
      executionKind: "user_operation",
      signer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      chainId: 31337,
      description: "Register root",
      payloads: [{ kind: "evm_personal", message: "0x00" }],
      calls: [{ to: ANCHOR, value: "0", data: registerRoot() }],
    };
    expect(expectRoot.verify(request).mismatches).toEqual([
      expect.objectContaining({ field: "simulation", actual: "unavailable" }),
    ]);
    expect(
      new ExpectedCalls(expectRoot.calls, {
        allowUnavailableSimulation: true,
      }).verify(request).ok,
    ).toBe(true);
  });

  it("fails closed for missing or non-call requests", () => {
    expect(expectRoot.verify(undefined).mismatches).toEqual([
      expect.objectContaining({ field: "request" }),
    ]);
    const message: ActionRequest = {
      type: "sign",
      requestId: "message",
      chainFamily: "evm",
      executionKind: "evm_personal",
      signer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      description: "Sign in",
      payloads: [{ kind: "evm_personal", message: "hello" }],
    };
    expect(expectRoot.verify(message).mismatches).toEqual([
      expect.objectContaining({ field: "request", actual: "sign" }),
    ]);
    expect(
      expectRoot.verify({
        kind: "svm_transaction",
        signer: "So11111111111111111111111111111111111111112",
        transaction_base64: "AA==",
      }).ok,
    ).toBe(false);
  });

  it("assert throws a CallVerificationError listing every mismatch", () => {
    const request = evmRequest(
      [{ to: TOKEN, data: registerRoot(OTHER_ROOT), value: "1" }],
      "failed",
    );
    let thrown: unknown;
    try {
      expectRoot.assert(request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CallVerificationError);
    const error = thrown as CallVerificationError;
    expect(error.verification.mismatches.map((m) => m.field)).toEqual([
      "simulation",
      "to",
      "value",
      "args",
    ]);
    expect(error.message.split("\n")).toHaveLength(5);
  });

  it("requires at least one expected call", () => {
    expect(() => new ExpectedCalls([])).toThrow(TypeError);
  });
});
