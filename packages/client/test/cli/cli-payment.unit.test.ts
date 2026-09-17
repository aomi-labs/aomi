import { describe, expect, it } from "vitest";

import { printPaymentEvent } from "../../src/cli/output";

describe("CLI payment output", () => {
  it("prints the requested x402 amount, network, and recipient", () => {
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => lines.push(line);

    try {
      printPaymentEvent({
        type: "required",
        url: "http://unit.test/v1/agent/chat",
        requirement: {
          amount: "25000",
          network: "eip155:84532",
          payTo: "0x1111111111111111111111111111111111111111",
        },
      });
    } finally {
      console.error = originalError;
    }

    expect(lines[0]).toContain("x402 payment required");
    expect(lines[0]).toContain("amount 25000");
    expect(lines[0]).toContain("eip155:84532");
    expect(lines[0]).toContain(
      "beneficiary 0x1111111111111111111111111111111111111111",
    );
  });

  it("prints the settlement receipt when x402 payment clears", () => {
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => lines.push(line);

    try {
      printPaymentEvent({
        type: "settled",
        url: "http://unit.test/v1/agent/chat",
        status: 200,
        receiptId: "0xreceipt",
      });
    } finally {
      console.error = originalError;
    }

    expect(lines[0]).toContain("x402 payment settled: 0xreceipt");
  });

  it("prints the x402 rejection reason when the server supplies one", () => {
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: string) => lines.push(line);

    try {
      printPaymentEvent({
        type: "rejected",
        url: "http://unit.test/v1/agent/chat",
        status: 402,
        reason:
          "submitted payment requirements did not match the requested price",
      });
    } finally {
      console.error = originalError;
    }

    expect(lines[0]).toContain("submitted payment requirements did not match");
  });
});
