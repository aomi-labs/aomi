import { describe, expect, it } from "vitest";
import { resolveGracefulEvmIdentity } from "./identity-grace";

describe("resolveGracefulEvmIdentity", () => {
  it("preserves a connected EVM identity during a short network handoff", () => {
    const result = resolveGracefulEvmIdentity({
      current: {},
      previous: {
        address: "0xabc",
        chainId: 42161,
        connectorId: "rabby",
        walletName: "Rabby",
      },
      selectedChainId: 1,
      disconnectedAt: null,
      now: 1000,
      graceMs: 1800,
      explicitDisconnect: false,
    });

    expect(result).toEqual({
      identity: {
        address: "0xabc",
        chainId: 1,
        connectorId: "rabby",
        walletName: "Rabby",
      },
      disconnectedAt: 1000,
      usingCachedIdentity: true,
    });
  });

  it("uses the live EVM identity as soon as wagmi restores", () => {
    const result = resolveGracefulEvmIdentity({
      current: {
        address: "0xabc",
        chainId: 1,
        connectorId: "rabby",
        walletName: "Rabby",
      },
      previous: {
        address: "0xabc",
        chainId: 42161,
        connectorId: "rabby",
        walletName: "Rabby",
      },
      selectedChainId: 1,
      disconnectedAt: 1000,
      now: 1100,
      graceMs: 1800,
      explicitDisconnect: false,
    });

    expect(result).toEqual({
      identity: {
        address: "0xabc",
        chainId: 1,
        connectorId: "rabby",
        walletName: "Rabby",
      },
      disconnectedAt: null,
      usingCachedIdentity: false,
    });
  });

  it("clears immediately for an explicit user disconnect", () => {
    const result = resolveGracefulEvmIdentity({
      current: {},
      previous: {
        address: "0xabc",
        chainId: 42161,
      },
      selectedChainId: 1,
      disconnectedAt: null,
      now: 1000,
      graceMs: 1800,
      explicitDisconnect: true,
    });

    expect(result).toEqual({
      identity: {},
      disconnectedAt: null,
      usingCachedIdentity: false,
    });
  });

  it("expires stale cached identities after the grace window", () => {
    const result = resolveGracefulEvmIdentity({
      current: {},
      previous: {
        address: "0xabc",
        chainId: 42161,
      },
      selectedChainId: 1,
      disconnectedAt: 1000,
      now: 3000,
      graceMs: 1800,
      explicitDisconnect: false,
    });

    expect(result).toEqual({
      identity: {},
      disconnectedAt: 1000,
      usingCachedIdentity: false,
    });
  });

  it("stays expired on later renders instead of restarting the grace window", () => {
    const expired = resolveGracefulEvmIdentity({
      current: {},
      previous: { address: "0xabc", chainId: 42161 },
      selectedChainId: 1,
      disconnectedAt: 1000,
      now: 3000,
      graceMs: 1800,
      explicitDisconnect: false,
    });

    // Feed the expired result back in, as the provider does between renders.
    // The identity must not flip back to the cached address — that re-flip is
    // what made the wallet logo / network chip flash once per grace window.
    const nextRender = resolveGracefulEvmIdentity({
      current: {},
      previous: { address: "0xabc", chainId: 42161 },
      selectedChainId: 1,
      disconnectedAt: expired.disconnectedAt,
      now: 4000,
      graceMs: 1800,
      explicitDisconnect: false,
    });

    expect(nextRender).toEqual({
      identity: {},
      disconnectedAt: 1000,
      usingCachedIdentity: false,
    });
  });
});
