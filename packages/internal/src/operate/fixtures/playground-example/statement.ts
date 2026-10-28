import type { StatementRows } from "../types";

// x402 tools at $0.25/call (10% share), managed keys, lighter traffic.

export const statement: StatementRows = {
  revenue: [
    { subject: "tool_invocation", events: 21, gross: 5.25, platformFee: 0.53, net: 4.72 },
  ],
  charges: [
    { item: "model", events: 88, amount: 1.87 },
    { item: "hosting", events: 1, amount: 10.0 },
  ],
  entries: [
    { day: "2026-07-15", subject: "tool_invocation", events: 13, gross: 3.25, platformFee: 0.33, net: 2.92 },
    { day: "2026-07-15", subject: "model", events: 50, gross: 1.02, platformFee: 0.09, net: -1.02 },
    { day: "2026-07-14", subject: "tool_invocation", events: 8, gross: 2.0, platformFee: 0.2, net: 1.8 },
    { day: "2026-07-14", subject: "model", events: 38, gross: 0.85, platformFee: 0.08, net: -0.85 },
    { day: "2026-07-01", subject: "hosting", events: 1, gross: 10.0, platformFee: 10.0, net: -10.0 },
  ],
};
