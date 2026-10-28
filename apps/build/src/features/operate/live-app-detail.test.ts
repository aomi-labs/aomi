import { describe, expect, it } from "vitest";
import {
  liveAppDetailView,
  type LiveAppDetailPayload,
} from "./live-app-detail";

const livePayload = (): LiveAppDetailPayload => ({
  detail: {
    project: {
      id: 1586,
      repositoryLink: "https://github.com/aomi/real-app",
      repositoryOwner: "aomi",
      repositoryName: "real-app",
      defaultBranch: "main",
      installationId: 42,
    },
    platform: "community",
    windowSeconds: 86_400,
    app: {
      applicationId: 77,
      name: "real-app",
      releaseTag: "apps-1586-real-app-abc123",
      sdkVersion: "3.0.3",
      active: true,
      loaded: true,
      status: "healthy",
    },
    funnel: {
      chats24h: 12,
      toolCalls24h: 30,
      txProposed24h: 4,
      txSubmitted24h: 3,
      txConfirmed24h: 2,
      txReverted24h: 1,
    },
    activeUsers24h: 5,
    credits: {
      credits24h: 8.5,
      creditsPerTurn24h: 0.71,
      creditsDaily: [{ day: "2026-07-19", credits: 8.5 }],
    },
    tools: [
      {
        tool: "get_price",
        calls: 20,
        errors: 1,
        errorRate: 0.05,
        p95Ms: 310,
        lastError: null,
      },
    ],
    lifecycle: {
      coldStartMs: 1_250,
      dylibBytes: 4_718_592,
      loads24h: 2,
      evictions24h: 1,
    },
    hourly: {
      chats: [0, 2, 3],
      toolCalls: [1, 4, 5],
      p95LatencyMs: [800, null, 950],
      transactions: [0, 1, 1],
    },
  },
  health: {
    applicationId: 77,
    application: "real-app",
    active: true,
    loaded: true,
    releaseTag: "apps-1586-real-app-abc123",
    sdkVersion: "3.0.3",
    status: "healthy",
    metrics: {
      provider: "grafana_prometheus",
      windowSeconds: 86_400,
      available: true,
      requestsPerMinute: 2.4,
      errorRate: 0.02,
      p95LatencyMs: 1_200,
      inflightRequests: 1,
      trendWindowSeconds: 86_400,
      chats24h: 12,
      toolCalls24h: 30,
      transactions24h: 4,
      chatsHourly: [0, 2, 3],
      toolCallsHourly: [1, 4, 5],
      transactionsHourly: [0, 1, 1],
      toolErrorRate: 0.05,
      txErrorRate: 0.1,
      coldStartMs: 1_250,
      dylibBytes: 4_718_592,
    },
  },
  transactions: [
    {
      id: "tx-real",
      externalTxId: "external-real",
      application: "real-app",
      applicationId: 77,
      status: "confirmed",
      txHash: "0xabc",
      chainId: 1,
      fromAddress: "0xfrom",
      toAddress: "0xto",
      value: "1",
      hasCalldata: false,
      calldataPreview: null,
      description: "Real transfer",
      createdAt: 1_752_966_000,
      updatedAt: 1_752_966_060,
      submittedAt: 1_752_966_010,
      family: "evm",
      chainName: "Ethereum",
      fromLabel: null,
      toLabel: null,
      valueUsd: "3500.00",
      block: "123",
      slot: null,
      confirmations: 12,
      gasUsed: "21000",
      gasLimit: "21000",
      effGasPrice: "10",
      computeUnits: null,
      computeLimit: null,
      priorityFee: null,
      txFee: "0.00021",
      platformFee: "0.00",
      nonce: 1,
      method: "transfer",
      transfers: [],
      revertReason: null,
      explorerUrl: "https://etherscan.io/tx/0xabc",
    },
  ],
  logs: [
    {
      occurredAt: 1_752_966_000,
      eventType: "tool_completed",
      id: "log-real",
      application: "real-app",
      applicationId: 77,
      summary: "Real tool result",
      details: {},
      modelKey: null,
      kind: "invocation",
      status: "ok",
      tool: "get_price",
      durationMs: 310,
      retries: 0,
      threadId: "thread-real",
      args: "{}",
      result: '{"price": 1}',
    },
  ],
  deployments: [],
});

describe("liveAppDetailView", () => {
  it("keeps live aggregates and rows authoritative", () => {
    const view = liveAppDetailView(livePayload());

    expect(view.app.meta).toMatchObject({
      name: "real-app",
      applicationId: 77,
      families: ["evm"],
      repo: "https://github.com/aomi/real-app",
    });
    expect(view.app.detail.funnel.map((row) => row.value)).toEqual([
      12, 30, 4, 3, 2,
    ]);
    expect(view.app.detail.tools).toEqual([
      expect.objectContaining({ tool: "get_price", calls: 20, errors: 1 }),
    ]);
    expect(view.app.transactions).toEqual([
      expect.objectContaining({ id: "tx-real", description: "Real transfer" }),
    ]);
    expect(view.app.logs).toEqual([
      expect.objectContaining({
        summary: "Real tool result",
        thread: "thread-real",
      }),
    ]);
    expect(view.app.detail.p95Hourly).toEqual([0.8, null, 0.95]);
  });

  it("renders missing backend values as empty or unavailable, never fixtures", () => {
    const payload = livePayload();
    payload.detail.funnel.chats24h = null;
    payload.detail.activeUsers24h = null;
    payload.detail.credits = {
      credits24h: null,
      creditsPerTurn24h: null,
      creditsDaily: [],
    };
    payload.detail.tools = [];
    payload.detail.hourly = {
      chats: null,
      toolCalls: null,
      p95LatencyMs: null,
      transactions: null,
    };
    payload.health = null;
    payload.transactions = [];
    payload.logs = [];

    const view = liveAppDetailView(payload);

    expect(view.app.detail.funnel[0]?.value).toBeNull();
    expect(view.app.meta.families).toEqual([]);
    expect(view.app.detail.tools).toEqual([]);
    expect(view.app.detail.p95Hourly).toEqual([]);
    expect(
      Object.fromEntries(
        view.app.detail.kpis.map((kpi) => [kpi.label, kpi.value]),
      ),
    ).toMatchObject({
      "Active users": "—",
      Credits: "—",
      "Credits / turn": "—",
      "P95 latency": "No samples",
      Inflight: "Unavailable",
      "Chat errors": "No samples",
      "Tool errors": "—",
      "Tx failures": "—",
    });
    expect(view.app.transactions).toEqual([]);
    expect(view.app.logs).toEqual([]);
  });

  it("shows measured zero health values and the health time window", () => {
    const payload = livePayload();
    Object.assign(payload.health!.metrics, {
      inflightRequests: 0,
      errorRate: 0,
    });
    const kpis = liveAppDetailView(payload).app.detail.kpis;
    expect(kpis.find((kpi) => kpi.label === "Inflight")).toMatchObject({
      value: "0",
      sub: "Active turns now",
    });
    expect(kpis.find((kpi) => kpi.label === "Chat errors")).toMatchObject({
      value: "0.0%",
      sub: "24h",
    });
    expect(kpis.find((kpi) => kpi.label === "P95 latency")?.sub).toBe("24h");
  });

  it("preserves unknown per-tool counts instead of reporting zero", () => {
    const payload = livePayload();
    payload.detail.tools[0].calls = null;
    payload.detail.tools[0].errors = null;

    const view = liveAppDetailView(payload);

    expect(view.app.detail.tools[0]).toMatchObject({
      calls: null,
      errors: null,
    });
    expect(view.app.detail.toolsSummary).toBe("— calls · — errors");
  });
});
