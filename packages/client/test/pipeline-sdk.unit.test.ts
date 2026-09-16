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
  version: 1,
  status: "staged",
  actions: [
    {
      id: "action-1",
      chainId: 1,
      calls: [
        {
          to: "0x1111111111111111111111111111111111111111",
          data: "0x",
          value: "0",
        },
      ],
    },
  ],
  digest: "sha256:evm-staged",
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
      { asset: "USDC", amount: "100", direction: "out", chainId: 1 },
    ],
    fees: [{ asset: "ETH", amount: "0.0001" }],
    warnings: [],
  },
};

const svmStaged: SvmStagedBuild = {
  version: 1,
  status: "staged",
  actions: [
    {
      id: "svm-action-1",
      kind: "instructions",
      cluster: "solana:devnet",
      instructions: [
        {
          programId: "Program1111111111111111111111111111111111",
          accounts: [{ pubkey: "Owner111", isSigner: true, isWritable: true }],
          data: "AA==",
        },
      ],
    },
  ],
  digest: "sha256:svm-staged",
};

const svmSimulated: SvmSimulatedBuild = {
  ...svmStaged,
  status: "simulated",
  digest: "sha256:svm-simulated",
  simulation: {
    status: "passed",
    balanceChanges: [],
    fees: [{ asset: "SOL", amount: "0.000005" }],
    warnings: [],
  },
};

describe("Pipeline SDK lifecycle", () => {
  it("sends portable EVM values through typed stage, simulate, and commit", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/stage")) return Response.json(evmStaged);
      if (url.endsWith("/simulate")) return Response.json(evmSimulated);
      if (url.endsWith("/commit")) {
        return Response.json({
          version: 1,
          status: "committed",
          digest: evmSimulated.digest,
          receipts: [{ transactionId: "0xtx", status: "confirmed" }],
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
          chainId: 1,
          calls: [
            {
              to: "0x1111111111111111111111111111111111111111",
              data: "0x",
              value: 0n,
            },
          ],
        },
      ],
    });
    const simulated = await evm.simulate(staged);
    const receipt = await evm.commit(simulated);

    expect(receipt.status).toBe("committed");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example/v1/pipeline/evm/stage",
      "https://api.example/v1/pipeline/evm/simulate",
      "https://api.example/v1/pipeline/evm/commit",
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      actions: [{ calls: [{ value: "0" }] }],
    });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      build: evmStaged,
    });
    expect(
      new Headers(fetch.mock.calls[2][1]?.headers).get("idempotency-key"),
    ).toBe(evmSimulated.digest);
  });

  it("preserves SVM instruction semantics through the fluent lifecycle", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/stage")) return Response.json(svmStaged);
      if (url.endsWith("/simulate")) return Response.json(svmSimulated);
      throw new Error(`Unexpected request ${url}`);
    });
    const aomi = new Aomi({
      baseUrl: "https://api.example",
      fetch: fetch as typeof globalThis.fetch,
      guest: false,
    });

    const staged = await aomi.pipeline.svm.stage({
      kind: "instructions",
      cluster: "solana:devnet",
      instructions:
        svmStaged.actions[0].kind === "instructions"
          ? svmStaged.actions[0].instructions
          : [],
    });
    const build = await staged.simulate();

    expect(build).toBeInstanceOf(SvmBuild);
    expect(build.status).toBe("simulated");
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
      kind: "instructions",
      cluster: "solana:devnet",
    });
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
          version: 1,
          status: "committed",
          digest: evmSimulated.digest,
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
    expect(build.simulation.balanceChanges[0]?.asset).toBe("USDC");
    await expect(build.commit()).resolves.toMatchObject({
      status: "committed",
    });
    expect(aomi.raw).toBeInstanceOf(AomiClient);
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      operation: descriptor.href,
      arguments: { asset: "USDC", amount: "100" },
    });
  });

  it("returns the canonical Action without implicitly executing it", async () => {
    const action = pendingAction({
      type: "execute_evm",
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
          version: 1,
          status: "awaiting_wallet",
          digest: evmSimulated.digest,
          action,
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
    expect(result.action).toEqual(action);
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
