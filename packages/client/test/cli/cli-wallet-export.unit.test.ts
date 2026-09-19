import { describe, expect, it } from "vitest";
import type { Eip5792SendCallsParams } from "../../src/cli/eip5792";
import {
  formatWalletExport,
  parseWalletExportFormat,
} from "../../src/cli/wallet-export";

const params: Eip5792SendCallsParams = {
  version: "2.0.0",
  from: "0x1111111111111111111111111111111111111111",
  chainId: "0x10e6",
  atomicRequired: false,
  calls: [
    {
      to: "0x2222222222222222222222222222222222222222",
      data: "0xaabb",
      value: "0x3e8",
    },
  ],
};

describe("wallet export formats", () => {
  it("defaults to eip5792 and accepts the documented names", () => {
    expect(parseWalletExportFormat(undefined)).toBe("eip5792");
    expect(parseWalletExportFormat(" EIP5792 ")).toBe("eip5792");
    expect(parseWalletExportFormat("moss")).toBe("moss");
    expect(parseWalletExportFormat("MetaMask")).toBe("metamask");
  });

  it("rejects undocumented format names", () => {
    expect(() => parseWalletExportFormat("mm")).toThrow(
      'Use "eip5792", "moss", or "metamask"',
    );
  });

  it("keeps the canonical EIP-5792 object unchanged", () => {
    expect(formatWalletExport(params, "eip5792")).toBe(params);
  });

  it("emits the ordered call array for MOSS", () => {
    expect(formatWalletExport(params, "moss")).toEqual(params.calls);
  });

  it("emits MetaMask's numeric chain and raw transaction payload", () => {
    expect(formatWalletExport(params, "metamask")).toEqual({
      chainId: 4326,
      payload: params.calls[0],
    });
  });

  it("does not flatten multiple calls into sequential MetaMask sends", () => {
    expect(() =>
      formatWalletExport(
        { ...params, calls: [...params.calls, params.calls[0]] },
        "metamask",
      ),
    ).toThrow("metamask format supports exactly one call");
  });
});
