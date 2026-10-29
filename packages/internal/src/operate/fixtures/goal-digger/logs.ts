import type { LogRecord } from "../types";

export const logs: LogRecord[] = [
  {
    ts: 1784560078, day: "Jul 15", at: "17:47:58", app: "goal-digger",
    kind: "invocation", status: "ok", tool: "swap_quote",
    durationMs: 1840, thread: "thread_af92c1",
    summary: "SOL → USDC 2.5 · out 412.34",
    args: '{ "token_in": "SOL", "token_out": "USDC", "amount": "2.5", "slippage_bps": 50 }',
    result: '{ "route": "jupiter_v6", "amount_out": "412.34", "price_impact_bps": 11 }',
  },
  {
    ts: 1784559912, day: "Jul 15", at: "17:45:12", app: "goal-digger",
    kind: "event", status: "info", eventType: "deployment",
    summary: "Activated release apps-141779906-r1dac12ad71-goal-digger",
  },
  {
    ts: 1784556492, day: "Jul 15", at: "16:48:12", app: "goal-digger",
    kind: "invocation", status: "error", tool: "swap_quote",
    durationMs: 2140, thread: "thread_be44a0", retries: 3,
    summary: "SlippageToleranceExceeded: 340 bps > 50 bps · order $14.7k vs pool $48k",
    args: '{ "token_in": "SOL", "token_out": "BONK", "amount": "4.0", "slippage_bps": 50 }',
    result:
      "custom program error 0x1771 — SlippageToleranceExceeded: quote moved 340 bps > 50 bps limit (pool depth $48k, order $14.7k)",
  },
  {
    ts: 1784556451, day: "Jul 15", at: "16:47:31", app: "goal-digger",
    kind: "invocation", status: "error", tool: "swap_quote",
    durationMs: 1980, thread: "thread_be44a0", retries: 2,
    summary: "SlippageToleranceExceeded: 290 bps > 50 bps",
    args: '{ "token_in": "SOL", "token_out": "BONK", "amount": "4.0", "slippage_bps": 50 }',
    result: "custom program error 0x1771 — SlippageToleranceExceeded: quote moved 290 bps > 50 bps limit",
  },
  {
    ts: 1784547003, day: "Jul 15", at: "14:10:03", app: "goal-digger",
    kind: "event", status: "info", eventType: "app_evicted",
    summary: "Evicted after 45m idle (memory pressure policy)",
  },
  {
    ts: 1784546564, day: "Jul 15", at: "14:02:44", app: "goal-digger",
    kind: "invocation", status: "ok", tool: "swap_quote",
    durationMs: 920, thread: "thread_af92c1",
    summary: "SOL → USDC 1.2 · out 198.06",
    args: '{ "token_in": "SOL", "token_out": "USDC", "amount": "1.2", "slippage_bps": 30 }',
    result: '{ "route": "orca_whirlpool", "amount_out": "198.06", "price_impact_bps": 6 }',
  },
  {
    ts: 1784544679, day: "Jul 15", at: "13:31:19", app: "goal-digger",
    kind: "invocation", status: "error", tool: "rebalance_plan",
    durationMs: 1380, thread: "thread_af92c1",
    summary: "InsufficientBalance: needs 12.4 SOL, holds 9.1",
    args: '{ "target": { "SOL": 0.6, "USDC": 0.4 }, "max_trades": 3 }',
    result: "InsufficientBalance: plan requires 12.4 SOL, wallet holds 9.1 SOL",
  },
  {
    ts: 1784536807, day: "Jul 15", at: "11:20:07", app: "goal-digger",
    kind: "invocation", status: "error", tool: "swap_quote",
    durationMs: 640, thread: "thread_90ff21",
    summary: "InsufficientBalance: holds 3,201 USDC, order 50,000",
    args: '{ "token_in": "USDC", "token_out": "SOL", "amount": "50000", "slippage_bps": 20 }',
    result: "InsufficientBalance: wallet holds 3,201.40 USDC, order requires 50,000",
  },
  {
    ts: 1784532340, day: "Jul 15", at: "10:05:40", app: "goal-digger",
    kind: "invocation", status: "ok", tool: "rebalance_plan",
    durationMs: 1210, thread: "thread_90ff21",
    summary: "2 trades · est fee 0.00003 SOL",
    args: '{ "target": { "SOL": 0.5, "USDC": 0.5 }, "max_trades": 2 }',
    result: '{ "trades": 2, "est_fee": "0.00003 SOL" }',
  },
  {
    ts: 1784529292, day: "Jul 15", at: "09:14:52", app: "goal-digger",
    kind: "invocation", status: "ok", tool: "swap_quote",
    durationMs: 1104, thread: "thread_90ff21",
    summary: "USDC → SOL 3000 · out 18.16",
    args: '{ "token_in": "USDC", "token_out": "SOL", "amount": "3000", "slippage_bps": 20 }',
    result: '{ "route": "jupiter_v6", "amount_out": "18.164", "price_impact_bps": 4 }',
  },
];
