import { describe, expect, it, vi } from "vitest";
import {
  isMethodNotFound,
  normalizeCapabilityKeys,
  probeWalletCapabilities,
} from "./capability-probe";

const address = "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0";
const base = { "0x2105": { atomic: { status: "ready" } } };

describe("probeWalletCapabilities", () => {
  it("asks the provider it is given with the EIP-5792 v2 params", async () => {
    const request = vi.fn(async () => base);
    const probe = await probeWalletCapabilities({
      request,
      address,
      chainIds: [1, 8453],
    });
    expect(request).toHaveBeenCalledWith({
      method: "wallet_getCapabilities",
      params: [address, ["0x1", "0x2105"]],
    });
    expect(probe.capabilities["8453"]?.atomic?.status).toBe("ready");
  });

  it("falls back to the address-only form when the wallet rejects chain ids", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("bad params"), { code: -32602 }),
      )
      .mockResolvedValueOnce(base);
    const probe = await probeWalletCapabilities({
      request,
      address,
      chainIds: [8453],
    });
    expect(request).toHaveBeenLastCalledWith({
      method: "wallet_getCapabilities",
      params: [address],
    });
    expect(probe.capabilities["8453"]).toBeDefined();
  });

  it("treats -32601 as no EIP-5792 without a second call", async () => {
    const request = vi.fn().mockRejectedValue(
      Object.assign(new Error("method doesn't has corresponding handler"), {
        code: -32601,
      }),
    );
    const probe = await probeWalletCapabilities({
      request,
      address,
      chainIds: [8453],
    });
    expect(probe).toEqual({ capabilities: {}, unsupported: true });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("throws other failures so the caller can retry", async () => {
    const request = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(
      probeWalletCapabilities({ request, address, chainIds: [8453] }),
    ).rejects.toThrow("timeout");
  });
});

describe("capability keys", () => {
  it("accepts hex, decimal and eip155 chain keys", () => {
    const cap = { atomic: { status: "supported" } };
    expect(
      Object.keys(
        normalizeCapabilityKeys({
          "0x2105": cap,
          "10": cap,
          "eip155:42161": cap,
        }),
      ).sort(),
    ).toEqual(["10", "42161", "8453"]);
  });

  it("recognizes method-not-found errors by code or cause", () => {
    expect(isMethodNotFound({ code: -32601 })).toBe(true);
    expect(isMethodNotFound(new Error("x", { cause: { code: -32601 } }))).toBe(
      true,
    );
    expect(isMethodNotFound(new Error("timeout"))).toBe(false);
  });
});
