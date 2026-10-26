import type { LogRecord } from "../types";

export const logs: LogRecord[] = [
  {
    ts: 1784558220, day: "Jul 15", at: "17:17:00", app: "playground-example",
    kind: "invocation", status: "ok", tool: "swap_quote",
    durationMs: 1620, thread: "thread_2277ab",
    summary: "ETH → USDC 0.1 on Base · out 367.11",
    args: '{ "family": "evm", "chain": "base", "token_in": "ETH", "token_out": "USDC", "amount": "0.1", "slippage_bps": 40 }',
    result: '{ "route": "uniswap_v3", "amount_out": "367.11", "price_impact_bps": 5 }',
  },
  {
    ts: 1784550960, day: "Jul 15", at: "15:16:00", app: "playground-example",
    kind: "invocation", status: "ok", tool: "send_token",
    durationMs: 980, thread: "thread_31c0de",
    summary: "250 USDC on Solana → team wallet",
    args: '{ "family": "svm", "cluster": "mainnet-beta", "token": "USDC", "amount": "250", "to": "4Nd1…kX2p" }',
    result: '{ "signature": "3xWvBn…", "commitment": "finalized" }',
  },
  {
    ts: 1784547600, day: "Jul 15", at: "14:20:00", app: "playground-example",
    kind: "invocation", status: "error", tool: "bridge_quote",
    durationMs: 2410, thread: "thread_31c0de", retries: 1,
    summary: "RouteNotFound: SOL → Base under $50",
    args: '{ "from_family": "svm", "to_family": "evm", "to_chain": "base", "token": "SOL", "amount": "0.3" }',
    result: "RouteNotFound: no bridge route for $49.50 SOL → Base (min bridge size $50)",
  },
  {
    ts: 1784544000, day: "Jul 15", at: "13:20:00", app: "playground-example",
    kind: "event", status: "info", eventType: "app_loaded",
    summary: "Cold start 1010 ms · dylib 3.1 MB · SDK 3.0.2",
  },
  {
    ts: 1784475150, day: "Jul 14", at: "17:12:30", app: "playground-example",
    kind: "event", status: "error", eventType: "sdk_upgrade",
    summary: "Stranded on SDK 3.0.1 — rebuild queued by auto-heal",
  },
  {
    ts: 1784471000, day: "Jul 14", at: "16:03:20", app: "playground-example",
    kind: "event", status: "info", eventType: "deployment",
    summary: "Activated release apps-142228159-rb87f6980b6-playground-example",
  },
];
