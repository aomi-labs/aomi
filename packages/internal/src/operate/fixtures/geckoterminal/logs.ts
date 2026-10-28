import type { LogRecord } from "../types";

export const logs: LogRecord[] = [
  {
    ts: 1784559130, day: "Jul 15", at: "17:32:10", app: "geckoterminal",
    kind: "invocation", status: "ok", tool: "get_pool_stats",
    durationMs: 410, thread: "thread_10ab3f",
    summary: "WETH/USDC 0.05% on Base · TVL $48.2M",
    args: '{ "network": "base", "pool": "0xd0b53D9277642d899DF5C87A3966A349A798F224" }',
    result: '{ "tvl_usd": "48200000", "volume_24h_usd": "31400000", "fee_apr": "12.4%" }',
  },
  {
    ts: 1784553235, day: "Jul 15", at: "15:53:55", app: "geckoterminal",
    kind: "event", status: "info", eventType: "app_loaded",
    summary: "Cold start 890 ms · dylib 2.0 MB · SDK 3.0.2",
  },
  {
    ts: 1784551820, day: "Jul 15", at: "15:30:20", app: "geckoterminal",
    kind: "invocation", status: "error", tool: "get_trending",
    durationMs: 2900, thread: "thread_88cd01",
    summary: "UpstreamTimeout: geckoterminal API 429 after 2.9s",
    args: '{ "network": "ethereum", "window": "1h", "limit": 10 }',
    result: "UpstreamTimeout: api.geckoterminal.com returned 429 (rate limited), gave up after 1 retry",
  },
  {
    ts: 1784548212, day: "Jul 15", at: "14:30:12", app: "geckoterminal",
    kind: "invocation", status: "ok", tool: "get_price",
    durationMs: 280, thread: "thread_10ab3f",
    summary: "PEPE on Ethereum · $0.0000121",
    args: '{ "network": "ethereum", "token": "0x6982508145454Ce325dDbE47a25d4ec3d2311933" }',
    result: '{ "price_usd": "0.0000121", "change_24h": "-3.2%" }',
  },
  {
    ts: 1784540705, day: "Jul 15", at: "12:25:05", app: "geckoterminal",
    kind: "invocation", status: "ok", tool: "get_trending",
    durationMs: 1340, thread: "thread_77fe19",
    summary: "Base 1h trending · 10 pools",
    args: '{ "network": "base", "window": "1h", "limit": 10 }',
    result: '{ "pools": 10, "top": "AERO/USDC · vol $2.1M" }',
  },
];
