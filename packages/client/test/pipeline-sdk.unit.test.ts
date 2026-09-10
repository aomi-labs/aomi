import { describe, expect, it, vi } from "vitest";

import {
  Aomi,
  AomiClient,
  ActionHandler,
  EvmBuild,
  PipelineSchemaError,
  SvmBuild,
  walletCapabilities,
} from "../src";
import type {
  Action,
  EvmSimulatedBuild,
  EvmStagedBuild,
  SvmSimulatedBuild,
  SvmStagedBuild,
} from "../src";

function pendingAction(request: Action["request"]): Action {
  return {
    type: "action",
    event_id: "event-action-1",
    sequence: 1,
    turn_id: "turn-1",
    occurred_at: 1,
    id: "action-1",
    revision: 1,
    state: "pending",
    request,
    result: null,
    created_at: 1,
    expires_at: null,
  };
}

const evmStaged: EvmStagedBuild = {
  version: 2,
  status: "staged",
  actions: [
    {
      chain_id: 1,
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      to: "0x1111111111111111111111111111111111111111",
      data: "0x",
      value: "0",
      label: "Transfer",
      kind: "native_transfer",
    },
  ],
  origin: {
    app: "default",
    operations: [
      {
        operation: "/v1/pipeline/apps/default/operations/evm_stage_tx",
        arguments: {},
      },
    ],
  },
  expiresAt: 2_000_000_000,
  digest: "sha256:evm-staged",
  attestation: "evm-attestation",
};

const evmSimulated: EvmSimulatedBuild = {
  ...evmStaged,
  status: "simulated",
  digest: "sha256:evm-simulated",
  summary: {
    title: "Supply USDC",
    actionCount: 1,
    transactionCount: 1,
  },
  simulation: {
    status: "passed",
    balanceChanges: [
      {
        asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        amount: "100",
        direction: "out",
        chainId: 1,
        standard: "erc20",
        symbol: "USDC",
        decimals: 6,
        step: 1,
      },
    ],
    approvals: [
      {
        account: "0x1111111111111111111111111111111111111111",
        spender: "0x2222222222222222222222222222222222222222",
        asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        kind: "allowance",
        amount: "100",
        approved: true,
        unlimited: false,
        standard: "erc20",
        symbol: "USDC",
        decimals: 6,
        chainId: 1,
        step: 1,
      },
    ],
    fees: [{ asset: "ETH", amount: "0.0001" }],
    warnings: [],
    guards: [{ name: "batch_execution", status: "passed" }],
    gas: { units: "21000" },
    logs: [],
  },
};

const svmStaged: SvmStagedBuild = {
  version: 2,
  status: "staged",
  actions: [
    {
      id: 1,
      lane: "instruction",
      instruction: {
        payer: "Owner111",
        cluster: "solana:devnet",
        program_id: "Program1111111111111111111111111111111111",
        accounts: [{ pubkey: "Owner111", is_signer: true, is_writable: true }],
        data_base64: "AA==",
        description: "Transfer",
        kind: "transfer",
      },
    },
  ],
  origin: {
    app: "default",
    operations: [
      {
        operation: "/v1/pipeline/apps/default/operations/svm_stage_ix",
        arguments: {},
      },
    ],
  },
  expiresAt: 2_000_000_000,
  digest: "sha256:svm-staged",
  attestation: "svm-attestation",
};

const svmSimulated: SvmSimulatedBuild = {
  ...svmStaged,
  status: "simulated",
  digest: "sha256:svm-simulated",
  simulation: {
    status: "passed",
    balanceChanges: [],
    approvals: [],
    fees: [{ asset: "SOL", amount: "0.000005" }],
    warnings: [],
    guards: [{ name: "simulation", status: "passed" }],
    gas: null,
    logs: [],
  },
};

describe("Pipeline SDK lifecycle", () => {
  it("sends portable EVM values through typed stage, simulate, and commit", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/stage")) return Response.json(evmStaged);
      if (url.endsWith("/simulate")) return Response.json(evmSimulated);
      if (url.endsWith("/commit")) {
        return Response.json({
          status: "committed",
          digest: evmSimulated.digest,
          result: { submitted: true },
          requests: [],
        });
      }
      throw new Error(`Unexpected request ${url} ${init?.method}`);
    });
    const evm = new AomiClient({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    }).pipeline.evm;

    const staged = await evm.stage({
      actions: [
        {
          to: "0x1111111111111111111111111111111111111111",
          chain_id: 1,
          description: "Transfer",
          data: { signature: "", args: [], raw: "0x" },
          value: 0n,
        },
      ],
    });
    const simulated = await evm.simulate(staged);
    const receipt = await evm.commit(simulated);

    expect(staged.origin).toEqual(evmStaged.origin);
    expect(staged.expiresAt).toBe(evmStaged.expiresAt);
    expect(staged.attestation).toBe(evmStaged.attestation);
    expect(simulated.origin).toEqual(evmSimulated.origin);
    expect(simulated.expiresAt).toBe(evmSimulated.expiresAt);
    expect(simulated.attestation).toBe(evmSimulated.attestation);
    expect(receipt.status).toBe("committed");
    const keys = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("idempotency-key"),
    );
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(3);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example/v1/pipeline/evm/stage",
      "https://api.example/v1/pipeline/evm/simulate",
      "https://api.example/v1/pipeline/evm/commit",
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      actions: [{ value: "0", chain_id: 1 }],
    });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      build: evmStaged,
    });
    expect(JSON.parse(fetch.mock.calls[2][1]?.body as string)).toEqual({
      build: evmSimulated,
    });
    expect(
      new Headers(fetch.mock.calls[2][1]?.headers).get("idempotency-key"),
    ).toBe(evmSimulated.digest);
  });

  it("preserves SVM instruction semantics through the fluent lifecycle", async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/stage")) return Response.json(svmStaged);
      if (url.endsWith("/simulate")) return Response.json(svmSimulated);
      throw new Error(`Unexpected request ${url}`);
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    });

    const input = {
      kind: "instructions" as const,
      instructions: [
        {
          description: "Transfer",
          instructions: [{ program_id: "program", data_base64: "AA==" }],
        },
      ],
    };
    const staged = await aomi.pipeline.svm.stage(input);
    const build = await staged.simulate();

    expect(build).toBeInstanceOf(SvmBuild);
    expect(build.status).toBe("simulated");
    expect(staged.origin).toEqual(svmStaged.origin);
    expect(staged.expiresAt).toBe(svmStaged.expiresAt);
    expect(staged.attestation).toBe(svmStaged.attestation);
    expect(build.origin).toEqual(svmSimulated.origin);
    expect(build.expiresAt).toBe(svmSimulated.expiresAt);
    expect(build.attestation).toBe(svmSimulated.attestation);
    expect(
      fetch.mock.calls.every(([, init]) =>
        new Headers(init?.headers).has("idempotency-key"),
      ),
    ).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual(input);
    expect(build.actions[0]).toMatchObject({ lane: "instruction", id: 1 });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      build: svmStaged,
    });
  });

  it("converts every fluent EVM call without changing order or semantic kinds", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(evmStaged));
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch,
      guest: false,
    });
    const staged = await aomi.pipeline.evm.stage({
      app: "default",
      skills: ["transfers"],
      chainId: 8453,
      description: "Batch transfer",
      calls: [
        { to: "0x1111", value: 3n, gas: 21000n },
        { to: "0x2222", data: "0xabcd", description: "Second call" },
      ],
    });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      app: "default",
      skills: ["transfers"],
      actions: [
        {
          to: "0x1111",
          chain_id: 8453,
          description: "Batch transfer",
          data: { signature: "", args: [], raw: "0x" },
          value: "3",
          gas_limit: "21000",
        },
        {
          to: "0x2222",
          chain_id: 8453,
          description: "Second call",
          data: { signature: "", args: [], raw: "0xabcd" },
        },
      ],
    });
    expect(staged.actions[0].kind).toBe("native_transfer");
    expect(staged.toJSON()).toEqual(evmStaged);
  });

  it("preserves venue transaction bytes and returns canonical SVM wallet intents", async () => {
    const request: Action["request"] = {
      type: "execute_svm",
      transactions: [],
      simulation: svmSimulated.simulation,
    };
    const committed = {
      status: "committed",
      digest: svmSimulated.digest,
      results: [{ ok: true }],
      requests: [request],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(svmStaged))
      .mockResolvedValueOnce(Response.json(committed));
    const pipeline = new AomiClient({
      baseUrl: "https://api.example",
      fetch,
      guest: false,
    }).pipeline.svm;
    const input = {
      kind: "transaction" as const,
      transaction: {
        tx: "AQ==",
        preserve_blockhash: true,
        broadcaster: "venue" as const,
      },
    };
    await pipeline.stage(input);
    const result = await pipeline.commit(svmSimulated);

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      build: svmSimulated,
    });
    expect(result).toEqual(committed);
    expect(result.requests[0].type).toBe("execute_svm");
  });

  it("honors caller mutation keys and payment proofs for both build transports", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => Response.json(evmSimulated));
    const pipeline = new AomiClient({
      baseUrl: "https://api.example",
      fetch,
      guest: false,
    }).pipeline;
    const input = {
      operation: "/v1/pipeline/apps/default/operations/tool",
      arguments: {},
    };
    const options = {
      idempotencyKey: "build-operation",
      paymentSignature: "payment-proof",
    };
    await pipeline.evm.build(input, options);
    await pipeline.svm.build(input, options);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init.headers).get("idempotency-key")).toBe(
        options.idempotencyKey,
      );
      expect(new Headers(init.headers).get("payment-signature")).toBe(
        options.paymentSignature,
      );
    }
  });

  it("validates live operation arguments and keeps invocation runtime-typed", async () => {
    const descriptor = {
      kind: "operation",
      name: "supply",
      description: "Supply an asset",
      method: "POST",
      href: "/v1/pipeline/apps/aave/operations/supply",
      chainFamily: "evm",
      inputSchema: {
        type: "object",
        required: ["asset", "amount"],
        properties: {
          asset: { type: "string" },
          amount: { type: "string" },
        },
      },
    } as const;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ accepted: true })
        : Response.json(descriptor),
    );
    const pipeline = new AomiClient({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    }).pipeline;

    await expect(
      pipeline.app("aave").invoke("supply", {
        asset: "USDC",
        amount: "100",
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      pipeline.invoke("/apps/aave/operations/supply", { asset: "USDC" }),
    ).rejects.toBeInstanceOf(PipelineSchemaError);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toBe(
      "https://api.example/v1/pipeline/apps/aave/operations/supply",
    );
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      asset: "USDC",
      amount: "100",
    });
  });

  it("browses directories and authoritative skill instructions", async () => {
    const directory = {
      kind: "directory",
      path: "/v1/pipeline",
      entries: [{ name: "apps", kind: "directory", href: "/v1/pipeline/apps" }],
    };
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("/SKILL.md")
        ? new Response("# Safe lending", {
            headers: { "content-type": "text/markdown" },
          })
        : Response.json(directory),
    );
    const pipeline = new AomiClient({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    }).pipeline;

    await expect(pipeline.root()).resolves.toEqual(directory);
    await expect(pipeline.apps.list()).resolves.toEqual(directory);
    await expect(pipeline.app("aave").operations()).resolves.toEqual(directory);
    await expect(pipeline.skill("safe lending").instructions()).resolves.toBe(
      "# Safe lending",
    );

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example/v1/pipeline",
      "https://api.example/v1/pipeline/apps",
      "https://api.example/v1/pipeline/apps/aave/operations",
      "https://api.example/v1/pipeline/skills/safe%20lending/SKILL.md",
    ]);
    expect(new Headers(fetch.mock.calls[3][1]?.headers).get("accept")).toBe(
      "text/markdown",
    );
  });

  it("provides the golden app Build path and raw escape hatch", async () => {
    const descriptor = {
      kind: "operation",
      name: "supply",
      description: "Supply USDC",
      method: "POST",
      href: "/v1/pipeline/apps/aave/operations/supply",
      chainFamily: "evm",
      inputSchema: {
        type: "object",
        required: ["asset", "amount"],
        properties: {
          asset: { type: "string" },
          amount: { type: "string" },
        },
      },
    } as const;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/operations/supply")) return Response.json(descriptor);
      if (url.endsWith("/evm/build")) return Response.json(evmSimulated);
      if (url.endsWith("/evm/commit")) {
        return Response.json({
          status: "committed",
          digest: evmSimulated.digest,
          result: {},
          requests: [],
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    });

    const build = await aomi.pipeline
      .app("aave")
      .build("supply", { asset: "USDC", amount: "100" });

    expect(build).toBeInstanceOf(EvmBuild);
    expect(build.summary?.title).toBe("Supply USDC");
    expect(build.balanceChanges[0]?.symbol).toBe("USDC");
    expect(build.approvals[0]).toMatchObject({
      kind: "allowance",
      amount: "100",
      unlimited: false,
    });
    await expect(build.commit()).resolves.toMatchObject({
      status: "committed",
    });
    expect(aomi.raw).toBeInstanceOf(AomiClient);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      app: "aave",
      operation: descriptor.href,
      arguments: { asset: "USDC", amount: "100" },
    });
  });

  it("returns stateless commit requests without implicitly executing them", async () => {
    const action = pendingAction({
      type: "execute_evm",
      simulation: evmSimulated.simulation,
      transactions: [
        {
          chain_id: 1,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0x1111111111111111111111111111111111111111",
          value: "0",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
    });
    const sendCalls = vi.fn().mockResolvedValue({ hashes: ["0xsubmitted"] });
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/stage")) return Response.json(evmStaged);
      if (url.endsWith("/simulate")) return Response.json(evmSimulated);
      if (url.endsWith("/commit")) {
        return Response.json({
          status: "committed",
          digest: evmSimulated.digest,
          result: {},
          requests: [action.request],
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    });

    const build = await aomi.pipeline.evm.build({
      chainId: 1,
      calls: [
        {
          to: "0x1111111111111111111111111111111111111111",
          value: 0n,
        },
      ],
    });
    const result = await build.commit();

    expect(sendCalls).not.toHaveBeenCalled();
    expect(result.requests).toEqual([action.request]);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
      actions: [
        {
          to: "0x1111111111111111111111111111111111111111",
          chain_id: 1,
          description: "Transaction",
          data: { signature: "", args: [], raw: "0x" },
          value: "0",
        },
      ],
    });
  });
});

describe("wallet capabilities", () => {
  it("keeps SVM transaction signing distinct from message signing", async () => {
    const signTransaction = vi.fn().mockResolvedValue("signed-transaction");
    const signMessage = vi.fn().mockResolvedValue({ signature: "signature" });
    const result = {
      status: "signed" as const,
      outputs: [
        { id: "payload_1", signedTransactionBase64: "signed-transaction" },
        { id: "payload_2", signature: "signature" },
      ],
    };
    const respond = vi.fn(async (current: Action) => ({
      ...current,
      revision: current.revision + 1,
      state: "completed" as const,
      result,
    }));
    const handler = new ActionHandler(
      walletCapabilities({
        svm: {
          address: "Owner111",
          cluster: "solana:devnet",
          signTransaction,
          signMessage,
        },
      }),
      respond,
    );
    const action = pendingAction({
      type: "sign",
      requestId: "sign-1",
      chainFamily: "svm",
      executionKind: "transaction",
      signer: "Owner111",
      cluster: "solana:devnet",
      description: "Approve",
      payloads: [
        { kind: "svm_transaction", transaction_base64: "AQ==" },
        { kind: "svm_message", message_base64: "Ag==" },
      ],
    });

    handler.ingest(action);
    await handler.execute(action.id);
    expect(respond).toHaveBeenCalledWith(action, result, expect.any(String));
    expect(signTransaction).toHaveBeenCalledWith({
      transactionBase64: "AQ==",
      cluster: "solana:devnet",
    });
    expect(signMessage).toHaveBeenCalledWith({
      messageBase64: "Ag==",
      cluster: "solana:devnet",
    });
  });

  it("refuses to sign for a different configured wallet", async () => {
    const signMessage = vi.fn().mockResolvedValue("signature");
    const handler = new ActionHandler(
      walletCapabilities({
        evm: {
          address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chainId: 1,
          signMessage,
        },
      }),
      vi.fn(),
    );
    const action = pendingAction({
      type: "sign",
      requestId: "sign-foreign",
      chainFamily: "evm",
      executionKind: "message",
      signer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      chainId: 1,
      description: "Foreign signer",
      payloads: [{ kind: "evm_personal", message: "0x01" }],
    });

    handler.ingest(action);
    await expect(handler.execute(action.id)).rejects.toThrow(
      "active EVM wallet is not the requested signer",
    );
    expect(signMessage).not.toHaveBeenCalled();
  });
});
