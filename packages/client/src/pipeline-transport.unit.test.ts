import { describe, expect, it, vi } from "vitest";

import { AomiClient, PipelineApiError, type EvmStagedBuild } from "./";

describe("PipelineTransport", () => {
  it("uses the canonical filesystem discovery routes", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ kind: "directory", path: "/v1/pipeline", entries: [] }),
      );
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example/",
      fetch,
      guest: false,
    }).pipeline;

    const main = pipeline.agent();
    const acme = pipeline.agent("acme/prices");
    await pipeline.root();
    await main.operations();
    await main.core();
    await acme.operations();
    await acme.operation("get balance");
    await acme.packages();
    await acme.package("acme/feeds").directory();
    await acme.package("acme/feeds").operations();
    await acme.package("acme/feeds").skill("prices.md");

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://portal.example/v1/pipeline",
      "https://portal.example/v1/pipeline/operations",
      "https://portal.example/v1/pipeline/core",
      "https://portal.example/v1/pipeline/operations?agent=acme%2Fprices",
      "https://portal.example/v1/pipeline/operations/get%20balance?agent=acme%2Fprices",
      "https://portal.example/v1/pipeline/packages?agent=acme%2Fprices",
      "https://portal.example/v1/pipeline/packages/acme%2Ffeeds?agent=acme%2Fprices",
      "https://portal.example/v1/pipeline/packages/acme%2Ffeeds/operations?agent=acme%2Fprices",
      "https://portal.example/v1/pipeline/packages/acme%2Ffeeds/skills/prices.md?agent=acme%2Fprices",
    ]);
    expect(acme.package("acme/feeds").executionScope).toEqual({
      agent: "acme/prices",
      packages: ["acme/feeds"],
    });
    expect(main.executionScope).toEqual({});
  });

  it("surfaces stable policy errors and never retries invocation", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "pipeline_policy_denied",
            message: "Operation is not permitted",
            requestId: "request-1",
          },
        },
        { status: 403 },
      ),
    );
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).pipeline;

    await expect(
      pipeline.invoke(
        "/packages/acme%2Fswap/operations/write_tool",
        { value: 1 },
        { idempotencyKey: "pipeline-write-1", validate: false },
      ),
    ).rejects.toMatchObject<Partial<PipelineApiError>>({
      status: 403,
      code: "pipeline_policy_denied",
      retryable: false,
      requestId: "request-1",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      "pipeline-write-1",
    );
    expect(JSON.parse(init.body as string)).toEqual({ value: 1 });
  });

  it("validates an operation descriptor before invocation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          kind: "operation",
          name: "balance",
          method: "POST",
          href: "/v1/pipeline/operations/balance?agent=acme%2Fportfolio",
          inputSchema: {
            type: "object",
            required: ["owner"],
            properties: { owner: { type: "string" } },
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ balance: 1 }));
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).pipeline;

    await expect(
      pipeline.agent("acme/portfolio").invoke("balance", { owner: "wallet" }),
    ).resolves.toEqual({ balance: 1 });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://portal.example/v1/pipeline/operations/balance?agent=acme%2Fportfolio",
      "https://portal.example/v1/pipeline/operations/balance?agent=acme%2Fportfolio",
    ]);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("rejects an empty caller-owned idempotency key", async () => {
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example",
      fetch: vi.fn(),
      guest: false,
    }).pipeline;

    await expect(
      pipeline.invoke(
        "/operations/tool",
        {},
        { idempotencyKey: " ", validate: false },
      ),
    ).rejects.toThrow("idempotencyKey is required");
  });

  it("falls back to a typed retryable error for a malformed upstream body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("gateway", { status: 503 }));
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).pipeline;

    await expect(pipeline.root()).rejects.toMatchObject({
      status: 503,
      code: "pipeline_request_failed",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("EVM request transaction safety", () => {
  it.each([undefined, "strict", "balanced", "yolo"] as const)(
    "carries %s only when selected by the caller",
    async (mode) => {
      const fetch = vi.fn().mockImplementation(async () => Response.json({}));
      const pipeline = new AomiClient({
        baseUrl: "https://portal.example",
        fetch,
        guest: false,
      }).pipeline;
      await pipeline.evm.build({
        operation: "read",
        arguments: {},
        ...(mode ? { transactionSafetyMode: mode } : {}),
      });
      await pipeline.evm.stage({
        actions: [],
        ...(mode ? { transactionSafetyMode: mode } : {}),
      });
      for (const [, init] of fetch.mock.calls as [string, RequestInit][]) {
        const body = JSON.parse(init.body as string);
        if (mode) expect(body.transactionSafetyMode).toBe(mode);
        else expect(body).not.toHaveProperty("transactionSafetyMode");
      }
    },
  );
  it("preserves sealed mode during simulation and sends an explicit override separately", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({}));
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).pipeline;
    const build: EvmStagedBuild = {
      version: 2,
      status: "staged",
      actions: [],
      origin: { agent: "acme/test", operations: [] },
      expiresAt: 1,
      digest: "digest",
      attestation: "sealed",
      transactionSafetyMode: "strict",
    };
    await pipeline.evm.simulate(build);
    await pipeline.evm.simulate(build, { transactionSafetyMode: "balanced" });
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      build,
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({
      build,
      transactionSafetyMode: "balanced",
    });
    expect(build.transactionSafetyMode).toBe("strict");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://portal.example/v1/pipeline/evm/simulate?agent=acme%2Ftest",
    );
  });

  it("names the Build's agent on the query, never in the body", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({}));
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example",
      fetch,
      guest: false,
    }).pipeline;
    await pipeline.evm.stage({ agent: "acme/test", actions: [] });
    await pipeline.svm.build({
      agent: "acme/test",
      packages: ["acme/feeds"],
      operation: "/v1/pipeline/operations/read",
      arguments: {},
    });
    const sent = (fetch.mock.calls as [string, RequestInit][]).map(
      ([url, init]) => [url, JSON.parse(init.body as string)],
    );
    expect(sent).toEqual([
      [
        "https://portal.example/v1/pipeline/evm/stage?agent=acme%2Ftest",
        { actions: [] },
      ],
      [
        "https://portal.example/v1/pipeline/svm/build?agent=acme%2Ftest",
        {
          packages: ["acme/feeds"],
          operation: "/v1/pipeline/operations/read",
          arguments: {},
        },
      ],
    ]);
  });
});
