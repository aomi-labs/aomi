import { describe, expect, it, vi } from "vitest";

import { AomiClient, PipelineApiError } from "../src";

describe("PipelineTransport", () => {
  it("uses the canonical filesystem discovery routes", async () => {
    const fetch = vi.fn().mockImplementation(async () =>
      Response.json({ kind: "directory", path: "/v1/pipeline", entries: [] }),
    );
    const pipeline = new AomiClient({
      baseUrl: "https://portal.example/",
      fetch,
      guest: false,
    }).pipeline;

    await pipeline.root();
    await pipeline.apps.list();
    await pipeline.app("svm reads").directory();
    await pipeline.app("svm reads").operations();
    await pipeline.app("svm reads").operation("get balance");
    await pipeline.skills.list();
    await pipeline.skill("safe reads").directory();
    await pipeline.skill("safe reads").instructions();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://portal.example/v1/pipeline",
      "https://portal.example/v1/pipeline/apps",
      "https://portal.example/v1/pipeline/apps/svm%20reads",
      "https://portal.example/v1/pipeline/apps/svm%20reads/operations",
      "https://portal.example/v1/pipeline/apps/svm%20reads/operations/get%20balance",
      "https://portal.example/v1/pipeline/skills",
      "https://portal.example/v1/pipeline/skills/safe%20reads",
      "https://portal.example/v1/pipeline/skills/safe%20reads/SKILL.md",
    ]);
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
        "/apps/public-swap/operations/write_tool",
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
          href: "/v1/pipeline/apps/portfolio/operations/balance",
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
      pipeline.app("portfolio").invoke("balance", { owner: "wallet" }),
    ).resolves.toEqual({ balance: 1 });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://portal.example/v1/pipeline/apps/portfolio/operations/balance",
      "https://portal.example/v1/pipeline/apps/portfolio/operations/balance",
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
        "/apps/default/operations/tool",
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
