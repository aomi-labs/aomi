import type { AppFixture } from "../types";
import { transactions } from "./transactions";
import { logs } from "./logs";
import { statement } from "./statement";

// geckoterminal — EVM market-data app, read-only archetype: healthy tool
// traffic, zero transactions, BYOK model keys, unpriced tools.

export const geckoterminal: AppFixture = {
  meta: {
    name: "geckoterminal",
    applicationId: 78,
    families: ["evm"],
    releaseTag: "apps-141779906-r229e1090c5-geckoterminal",
    sdkVersion: "3.0.2",
    status: "healthy",
    repo: "aomi-labs/apps",
  },
  card: {
    requestsPerMinute: 0.1,
    errorRate: 0,
    p95LatencyMs: 3200,
    inflightRequests: 0,
    chats24h: 18,
    toolCalls24h: 52,
    transactions24h: 0,
    chatsHourly: [
      0, 0, 1, 0, 2, 1, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0,
    ],
    toolCallsHourly: [
      0, 0, 3, 0, 5, 2, 0, 0, 4, 6, 7, 3, 2, 0, 0, 0, 3, 5, 6, 3, 2, 1, 0, 0,
    ],
    transactionsHourly: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ],
    toolErrorRate: 0.019,
    txErrorRate: null,
    coldStartMs: 890,
    dylibBytes: 2097152,
  },
  detail: {
    funnel: [
      { label: "Chats", value: 18 },
      { label: "Tool calls", value: 52 },
      { label: "Tx proposed", value: 0 },
      { label: "Tx submitted", value: 0 },
      { label: "Tx confirmed", value: 0 },
    ],
    funnelNote: ["read-only app · no transactions"],
    kpis: [
      { label: "Chat errors", value: "0.0%" },
      { label: "Tool errors", value: "1.9%" },
      { label: "Tx failures", value: "—" },
      { label: "P95 turn", value: "3.2 s" },
      { label: "Inflight", value: "0" },
      { label: "Active users", value: "6", sub: "24h" },
      { label: "Credits", value: "0.78", sub: "0.043 / turn" },
      { label: "Fee accrued", value: "—", sub: "no priced streams" },
    ],
    chatsHourly: [
      0, 0, 1, 0, 2, 1, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0, 1, 2, 2, 1, 1, 0, 0, 0,
    ],
    toolCallsHourly: [
      0, 0, 3, 0, 5, 2, 0, 0, 4, 6, 7, 3, 2, 0, 0, 0, 3, 5, 6, 3, 2, 1, 0, 0,
    ],
    p95Hourly: [
      null,
      null,
      2.1,
      null,
      2.8,
      2.2,
      null,
      null,
      2.5,
      3.0,
      3.2,
      2.6,
      2.2,
      null,
      null,
      null,
      2.4,
      2.9,
      3.1,
      2.5,
      2.3,
      2.0,
      null,
      null,
    ],
    creditsDaily: {
      days: [
        "Jul 9",
        "Jul 10",
        "Jul 11",
        "Jul 12",
        "Jul 13",
        "Jul 14",
        "Jul 15",
      ],
      values: [0.4, 0.55, 0.61, 0.7, 0.66, 0.99, 0.78],
    },
    tools: [
      {
        tool: "get_price",
        calls: 21,
        errors: 0,
        errorRate: "0%",
        p95: "310 ms",
        last: "—",
      },
      {
        tool: "get_pool_stats",
        calls: 17,
        errors: 0,
        errorRate: "0%",
        p95: "520 ms",
        last: "—",
      },
      {
        tool: "get_trending",
        calls: 14,
        errors: 1,
        errorRate: "7.1%",
        p95: "2900 ms",
        last: "upstream 429 · 2h ago",
      },
    ],
    toolsSummary: "52 calls · 1 error",
    fees24h: "no onchain activity",
    lifecycle: [
      ["Cold start", "890 ms"],
      ["Dylib size", "2.0 MB"],
      ["Loads · 24h", "1"],
      ["Evictions · 24h", "0"],
    ],
    releases: [
      {
        tag: "r229e1090c5",
        when: "Jul 13, 11:02",
        current: true,
        note: "SDK 3.0.2",
      },
      {
        tag: "r11b7e44d09",
        when: "Jul 5, 16:40",
        current: false,
        note: "SDK 3.0.1",
      },
    ],
  },
  transactions,
  logs,
  statement,
};
