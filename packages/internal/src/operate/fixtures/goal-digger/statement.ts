import type { StatementRows } from "../types";

// x402 tools at $1.00/call (10% share), one outcome fee (30%), managed keys.

export const statement: StatementRows = {
  revenue: [
    { subject: "tool_invocation", events: 128, gross: 128.0, platformFee: 12.8, net: 115.2 },
    { subject: "outcome", events: 1, gross: 50.0, platformFee: 15.0, net: 35.0 },
  ],
  charges: [
    { item: "model", events: 152, amount: 10.03 },
    { item: "hosting", events: 1, amount: 10.0 },
  ],
  entries: [
    { day: "2026-07-15", subject: "outcome", events: 1, gross: 50.0, platformFee: 15.0, net: 35.0 },
    { day: "2026-07-15", subject: "tool_invocation", events: 42, gross: 42.0, platformFee: 4.2, net: 37.8 },
    { day: "2026-07-15", subject: "model", events: 68, gross: 4.1, platformFee: 0.37, net: -4.1 },
    { day: "2026-07-14", subject: "tool_invocation", events: 51, gross: 51.0, platformFee: 5.1, net: 45.9 },
    { day: "2026-07-14", subject: "model", events: 49, gross: 3.05, platformFee: 0.28, net: -3.05 },
    { day: "2026-07-13", subject: "tool_invocation", events: 35, gross: 35.0, platformFee: 3.5, net: 31.5 },
    { day: "2026-07-13", subject: "model", events: 35, gross: 2.88, platformFee: 0.26, net: -2.88 },
    { day: "2026-07-01", subject: "hosting", events: 1, gross: 10.0, platformFee: 10.0, net: -10.0 },
  ],
};
