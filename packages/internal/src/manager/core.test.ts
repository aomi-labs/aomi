// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagerClient } from "./client";
import { BrowserEnvironmentError, DeployError } from "@aomi-labs/deploy";

function client() {
  return new ManagerClient({
    url: "https://staging-api.example.com/",
    bearer: "act-token",
  });
}

describe("manager operate observability", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      Response.json({
        source: {
          id: 42,
          installation_id: 123,
          repository_id: 987,
          repository_link: "https://github.com/alice/demo.git",
          github_account: "alice",
        },
        platform: "community",
        scope: "owned_agents",
        monitoring: {
          provider: "grafana_prometheus",
          status: "ok",
          window_seconds: 300,
        },
        agents: [
          {
            agent_id: 77,
            agent: "demo",
            active: true,
            loaded: true,
            release_tag: "agents-123-demo-abc1234def56",
            sdk_version: "3.0.2",
            status: "healthy",
            pricing: {
              loaded_at: 1_785_118_000,
              config: {
                version: 1,
                beneficiaries: [
                  {
                    name: "banana_evm",
                    type: "evm_address",
                    chain: "eip155:84532",
                    value: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
                  },
                ],
                resources: {
                  get_idle_assets: {
                    pricing: { flat: 100 },
                    beneficiary: "banana_evm",
                  },
                },
                outcome: [],
              },
            },
            metrics: {
              provider: "grafana_prometheus",
              window_seconds: 300,
              available: true,
              requests_per_minute: 42,
              error_rate: 0.025,
              p95_latency_ms: 1234,
              inflight_requests: 3,
            },
          },
        ],
        dashboard_links: [
          {
            label: "Operate dashboard",
            url: "https://grafana.example.com/d/agent",
            scope: "owned_agents",
          },
        ],
        platform_metrics: [
          {
            label: "DB pool waiting",
            value: 0,
            unit: "connections",
            scope: "platform",
            description: "Shared DB pressure.",
          },
        ],
        payments: {
          available: true,
          scope: "recipient_bucket",
          summary: {},
          resources: [],
          buckets: [],
          events: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("maps snake_case Grafana metrics into agent observability fields", async () => {
    const result = await client().getUserProjectObservability({
      githubUserId: "4738254",
      platform: "community",
      projectId: 42,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/projects/42/observability?github_user_id=4738254",
    );
    expect(result.monitoring).toEqual({
      provider: "grafana_prometheus",
      status: "ok",
      windowSeconds: 300,
    });
    expect(result.agents[0].metrics).toEqual({
      provider: "grafana_prometheus",
      windowSeconds: 300,
      available: true,
      requestsPerMinute: 42,
      errorRate: 0.025,
      p95LatencyMs: 1234,
      inflightRequests: 3,
      // Legacy payload: the 24h trend contract stays null.
      trendWindowSeconds: null,
      chats24h: null,
      toolCalls24h: null,
      transactions24h: null,
      chatsHourly: null,
      toolCallsHourly: null,
      transactionsHourly: null,
      toolErrorRate: null,
      txErrorRate: null,
      coldStartMs: null,
      dylibBytes: null,
    });
    expect(result.agents[0].pricing).toMatchObject({
      loadedAt: 1_785_118_000,
      config: {
        resources: {
          get_idle_assets: {
            pricing: { flat: 100 },
            beneficiary: "banana_evm",
          },
        },
      },
    });
    expect(result.platformMetrics[0]).toEqual({
      label: "DB pool waiting",
      value: 0,
      unit: "connections",
      scope: "platform",
      description: "Shared DB pressure.",
    });
  });

  it("reads a source-filtered account snapshot without a payment ledger", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        results: [
          {
            source: { id: 42, installation_id: 123 },
            platform: "community",
            scope: "owned_agents",
            agents: [],
            dashboard_links: [],
            platform_metrics: [],
          },
        ],
      }),
    );

    const result = await client().getUserObservability({
      githubUserId: "4738254",
      platform: "community",
      projectId: 42,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/observability?github_user_id=4738254&project_id=42",
    );
    expect(result[0]).not.toHaveProperty("payments");
  });

  it("maps the separate account payment ledger", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        results: [
          {
            source: { id: 42, installation_id: 123 },
            payments: {
              available: true,
              scope: "recipient_bucket",
              summary: { priced_calls: 1 },
              resources: [],
              buckets: [],
              events: [],
            },
          },
        ],
      }),
    );

    const result = await client().getUserPayments({
      githubUserId: "4738254",
      projectId: 42,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/payments?github_user_id=4738254&project_id=42",
    );
    expect(result[0].payments.summary.pricedCalls).toBe(1);
  });

  it("maps the 24h trend contract when the manager emits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          monitoring: {
            provider: "grafana_prometheus",
            status: "ok",
            window_seconds: 900,
          },
          agents: [
            {
              agent_id: 77,
              agent: "demo",
              active: true,
              loaded: true,
              status: "healthy",
              metrics: {
                provider: "grafana_prometheus",
                window_seconds: 900,
                available: true,
                trend_window_seconds: 86400,
                chats_24h: 47,
                tool_calls_24h: 130,
                transactions_24h: 12,
                chats_hourly: [0, 3, "5"],
                tool_calls_hourly: [1, 2],
                transactions_hourly: [],
                tool_error_rate: 0.12,
                tx_error_rate: 0,
                cold_start_ms: 1250,
                dylib_bytes: 4718592,
              },
            },
          ],
        }),
      ),
    );

    const result = await client().getUserProjectObservability({
      githubUserId: "4738254",
      platform: "community",
      projectId: 42,
    });
    expect(result.agents[0].metrics).toMatchObject({
      trendWindowSeconds: 86400,
      chats24h: 47,
      toolCalls24h: 130,
      transactions24h: 12,
      chatsHourly: [0, 3, 5],
      toolCallsHourly: [1, 2],
      transactionsHourly: [],
      toolErrorRate: 0.12,
      txErrorRate: 0,
      coldStartMs: 1250,
      dylibBytes: 4718592,
    });
  });
});

describe("manager operate logs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes safe builder model-key attribution on usage events", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        source: {
          id: 42,
          repository_link: "https://github.com/alice/demo",
        },
        platform: "community",
        logs: [
          {
            occurred_at: 1_784_500_000,
            event_type: "usage",
            id: "usage-1",
            agent: "goal-digger",
            agent_id: 77,
            summary: "Usage openai/gpt-5-nano",
            details: {
              provider: "openai",
              model: "gpt-5-nano",
              payment_method: "agent_key",
              model_key: {
                id: 7,
                label: "test-1",
                prefix: "sk-proj",
              },
            },
            kind: "event",
          },
        ],
        next_cursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().listUserProjectLogs({
      githubUserId: "4738254",
      platform: "community",
      projectId: 42,
    });

    expect(result.logs[0]).toMatchObject({
      eventType: "usage",
      summary: "Usage openai/gpt-5-nano",
      modelKey: {
        id: 7,
        label: "test-1",
        prefix: "sk-proj",
      },
    });
  });
});

describe("manager Builder agent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads a canonical Agent from the Builder surface", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        project: {
          id: 42,
          installation_id: 555,
          repository_id: 9001,
          repository_link: "alice/demo",
          platform_id: 3,
          owner_builder_id: 9,
          created_at: 10,
          updated_at: 11,
        },
        platform: "community",
        agent: {
          id: 77,
          name: "demo",
          project_id: 42,
          is_active: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().getBuilderAgent({
      githubUserId: "4738254",
      agentId: 77,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/builder/agents/77?github_user_id=4738254",
    );
    expect(result).toMatchObject({
      project: { id: 42 },
      platform: "community",
      agent: { id: 77, name: "demo", projectId: 42 },
    });
  });

  it("reads and normalizes the owned agent detail aggregate", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        source: { id: 42, repository_link: "https://github.com/alice/demo" },
        platform: "community",
        window_seconds: 86400,
        agent: {
          agent_id: 77,
          name: "demo",
          release_tag: "agents-42-demo-abc1234",
          sdk_version: "3.0.3",
          active: true,
          loaded: true,
          status: "healthy",
        },
        funnel: {
          chats_24h: 12,
          tool_calls_24h: 30,
          tx_proposed_24h: 4,
          tx_submitted_24h: 3,
          tx_confirmed_24h: 2,
          tx_reverted_24h: 1,
        },
        active_users_24h: 5,
        credits: {
          credits_24h: 8.5,
          credits_per_turn_24h: 0.71,
          credits_daily: [{ day: "2026-07-19", credits: 8.5 }],
        },
        tools: [
          {
            tool: "get_price",
            calls: 20,
            errors: 1,
            error_rate: 0.05,
            p95_ms: 310,
            last_error: {
              message: "upstream timeout",
              occurred_at: 1784500000,
            },
          },
        ],
        lifecycle: {
          cold_start_ms: 1250,
          dylib_bytes: 4718592,
          loads_24h: 2,
          evictions_24h: 1,
        },
        hourly: {
          chats: [0, 2, 3],
          tool_calls: [1, 4, 5],
          p95_latency_ms: [800, null, 950],
          transactions: [0, 1, 1],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().getBuilderAgentDetail({
      githubUserId: "4738254",
      agentId: 77,
      window: "7d",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/builder/agents/77/detail?github_user_id=4738254&window=7d",
    );
    expect(result).toMatchObject({
      windowSeconds: 86400,
      agent: { agentId: 77, name: "demo", status: "healthy" },
      funnel: { chats24h: 12, txConfirmed24h: 2 },
      activeUsers24h: 5,
      credits: { credits24h: 8.5, creditsPerTurn24h: 0.71 },
      lifecycle: { coldStartMs: 1250, loads24h: 2 },
      hourly: {
        chats: [0, 2, 3],
        toolCalls: [1, 4, 5],
        p95LatencyMs: [800, null, 950],
      },
    });
    expect(result.tools[0]).toEqual({
      tool: "get_price",
      calls: 20,
      errors: 1,
      errorRate: 0.05,
      p95Ms: 310,
      lastError: {
        message: "upstream timeout",
        occurredAt: 1784500000,
      },
    });
  });
});

describe("manager operate statement", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      Response.json({
        source: {
          id: 42,
          installation_id: 123,
          repository_id: 987,
          repository_link: "https://github.com/alice/demo.git",
          github_account: "alice",
        },
        platform: "community",
        range: { from_date: "2026-07-01", to_date: "2026-07-15" },
        available: true,
        summary: {
          gross_revenue: 20.0,
          platform_fees: 4.0,
          service_charges: 13.3,
          net: 2.7,
        },
        revenue: [
          {
            subject: "tool_invocation",
            agent: "alpha",
            agent_id: 7,
            events: 4,
            gross: 8.0,
            platform_fee: 0.8,
            net: 7.2,
          },
        ],
        charges: [
          {
            item: "hosting",
            agent: "beta",
            agent_id: 9,
            events: 1,
            amount: 10.0,
          },
        ],
        entries: [
          {
            day: "2026-07-02",
            agent: "alpha",
            subject: "model",
            events: 3,
            gross: 3.3,
            platform_fee: 0.3,
            net: -3.3,
          },
        ],
        payments: {
          available: true,
          scope: "recipient_bucket",
          summary: {
            accrued_credits: 100,
            accrued_usd: 1,
            settled_credits: 100,
            settled_usd: 1,
            outstanding_credits: 0,
            outstanding_usd: 0,
            priced_calls: 1,
            settlements: 1,
          },
          resources: [
            {
              agent: "somm-agent",
              agent_id: 2936606,
              tool: "get_idle_assets",
              flat_credits: 100,
              flat_usd: 1,
              beneficiary: "banana_evm",
              recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
              chain: "eip155:84532",
              beneficiary_type: "evm_address",
              observed_calls: 1,
            },
          ],
          buckets: [
            {
              id: "proof-bucket",
              recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
              outstanding_credits: 0,
              outstanding_usd: 0,
            },
          ],
          events: [
            {
              id: "settle:proof",
              kind: "settlement_confirmed",
              occurred_at: 1_785_119_866,
              agent: "somm-agent",
              agent_id: 2936606,
              tools: [],
              credits: 100,
              usd: 1,
              asset: "USDC",
              asset_amount: 1,
              recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
              payment_method: "coinbase",
              receipt_id: "0x55e510",
              chain: "eip155:84532",
              explorer_url: "https://sepolia.basescan.org/tx/0x55e510",
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("maps the statement wire (subjects, entries, USD floats) to camelCase", async () => {
    const result = await client().getUserProjectStatement({
      githubUserId: "4738254",
      platform: "community",
      projectId: 42,
      fromDate: "2026-07-01",
      toDate: "2026-07-15",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/projects/42/statement?github_user_id=4738254&from_date=2026-07-01&to_date=2026-07-15",
    );
    expect(result.range).toEqual({
      fromDate: "2026-07-01",
      toDate: "2026-07-15",
    });
    expect(result.available).toBe(true);
    expect(result.summary).toEqual({
      grossRevenue: 20.0,
      platformFees: 4.0,
      serviceCharges: 13.3,
      net: 2.7,
    });
    expect(result.revenue).toEqual([
      {
        subject: "tool_invocation",
        agent: "alpha",
        agentId: 7,
        events: 4,
        gross: 8.0,
        platformFee: 0.8,
        net: 7.2,
      },
    ]);
    expect(result.charges).toEqual([
      {
        item: "hosting",
        agent: "beta",
        agentId: 9,
        events: 1,
        amount: 10.0,
      },
    ]);
    expect(result.entries).toEqual([
      {
        day: "2026-07-02",
        agent: "alpha",
        subject: "model",
        events: 3,
        gross: 3.3,
        platformFee: 0.3,
        net: -3.3,
      },
    ]);
    expect(result.payments.summary).toEqual({
      accruedCredits: 100,
      accruedUsd: 1,
      settledCredits: 100,
      settledUsd: 1,
      outstandingCredits: 0,
      outstandingUsd: 0,
      pricedCalls: 1,
      settlements: 1,
    });
    expect(result.payments.resources[0]).toMatchObject({
      agent: "somm-agent",
      agentId: 2936606,
      tool: "get_idle_assets",
      flatCredits: 100,
      observedCalls: 1,
    });
    expect(result.payments.buckets[0].id).toBe("proof-bucket");
    expect(result.payments.events[0]).toMatchObject({
      kind: "settlement_confirmed",
      receiptId: "0x55e510",
      chain: "eip155:84532",
    });
  });

  it("degrades to an unavailable zeroed statement when the table is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        source: {
          id: 42,
          installation_id: 123,
          repository_id: 987,
          repository_link: "x",
        },
        platform: "community",
        range: { from_date: "2026-07-01", to_date: "2026-07-15" },
        available: false,
        summary: {
          gross_revenue: 0.0,
          platform_fees: 0.0,
          service_charges: 0.0,
          net: 0.0,
        },
        revenue: [],
        charges: [],
        entries: [],
      }),
    );

    const result = await client().getUserProjectStatement({
      githubUserId: "4738254",
      platform: "community",
      projectId: 42,
    });
    expect(result.available).toBe(false);
    expect(result.summary.net).toBe(0);
    expect(result.revenue).toEqual([]);
  });
});

describe("manager projects", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the complete live SDK set from an account-wide Project list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          projects: [
            {
              id: 42,
              installation_id: 1,
              repository_link: "alice/demo",
              platform_name: "community",
              agents: [],
              sdk_version: null,
              sdk_versions: ["3.0.3", "3.0.4"],
              ffi_version: 1,
              ffi_versions: [1],
              required_ffi_version: 1,
              ffi_unrecorded: false,
            },
          ],
        }),
      ),
    );

    const [source] = await client().listUserProjects({ githubUserId: "42" });
    expect(source.sdkVersion).toBeNull();
    expect(source.sdkVersions).toEqual(["3.0.3", "3.0.4"]);
    expect(source).toMatchObject({
      ffiVersion: 1,
      ffiVersions: [1],
      requiredFfiVersion: 1,
      ffiUnrecorded: false,
      ffiIncompatible: false,
      ffiUnverifiedSdkVersions: [],
    });
  });

  it("tells an unloadable live SDK apart from a missing FFI record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          projects: [
            {
              id: 43,
              installation_id: 1,
              repository_link: "alice/legacy",
              platform_name: "community",
              agents: [],
              sdk_version: "4.0.0",
              sdk_versions: ["4.0.0"],
              ffi_version: null,
              ffi_versions: [],
              required_ffi_version: 1,
              ffi_unrecorded: true,
              ffi_incompatible: true,
              ffi_unverified_sdk_versions: ["4.0.0", 7, ""],
            },
            {
              id: 44,
              installation_id: 1,
              repository_link: "alice/older-manager",
              platform_name: "community",
              agents: [],
              sdk_version: "4.0.0",
              sdk_versions: ["4.0.0"],
              required_ffi_version: 1,
              ffi_unrecorded: true,
            },
          ],
        }),
      ),
    );

    const [legacy, olderManager] = await client().listUserProjects({
      githubUserId: "42",
    });
    expect(legacy).toMatchObject({
      ffiUnrecorded: true,
      ffiIncompatible: true,
      ffiUnverifiedSdkVersions: ["4.0.0"],
    });
    // A Manager that predates the field never claims incompatibility.
    expect(olderManager).toMatchObject({
      ffiUnrecorded: true,
      ffiIncompatible: false,
      ffiUnverifiedSdkVersions: [],
    });
  });
});

describe("manager GitHub App access", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads connected source repository access in camelCase", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: "action_required",
        repositories: [
          {
            project_id: 7,
            github_repo: "builder/repo-x",
            platform: "community",
            settings_url: "https://github.com/settings/installations/5",
            status: "missing_permissions",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await client().listUserGitHubAppInstallations({
      githubUserId: "42",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/installations?github_user_id=42",
    );
    expect(result).toEqual({
      status: "action_required",
      repositories: [
        {
          projectId: 7,
          githubRepo: "builder/repo-x",
          platform: "community",
          settingsUrl: "https://github.com/settings/installations/5",
          status: "missing_permissions",
        },
      ],
    });
  });

  it("returns an empty repository report", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ status: "ok", repositories: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().listUserGitHubAppInstallations({
      githubUserId: "42",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/installations?github_user_id=42",
    );
    expect(result).toEqual({ status: "ok", repositories: [] });
  });
});

describe("server-only guard", () => {
  it("throws in a browser-like environment", () => {
    const g = globalThis as Record<string, unknown>;
    g.window = {};
    g.document = {};
    try {
      expect(() => client()).toThrow(BrowserEnvironmentError);
    } finally {
      delete g.window;
      delete g.document;
    }
  });
});
