import type { StatementRows } from "../types";

// Read-only market data: tools run unpriced (gross $0), BYOK so no model
// charges are written — hosting is the only charge subject.

export const statement: StatementRows = {
  revenue: [
    { subject: "tool_invocation", events: 52, gross: 0, platformFee: 0, net: 0 },
  ],
  charges: [
    { item: "hosting", events: 1, amount: 10.0 },
  ],
  entries: [
    { day: "2026-07-15", subject: "tool_invocation", events: 30, gross: 0, platformFee: 0, net: 0 },
    { day: "2026-07-14", subject: "tool_invocation", events: 22, gross: 0, platformFee: 0, net: 0 },
    { day: "2026-07-01", subject: "hosting", events: 1, gross: 10.0, platformFee: 10.0, net: -10.0 },
  ],
};
