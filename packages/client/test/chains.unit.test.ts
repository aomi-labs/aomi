import { describe, expect, it } from "vitest";

import {
  ALCHEMY_CHAIN_SLUGS,
  CHAIN_NAMES,
  CHAINS_BY_ID,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
} from "../src/index";

describe("supported chain metadata", () => {
  it("keeps CLI chain IDs, names, and viem chain configs in sync", () => {
    expect(SUPPORTED_CHAIN_IDS).toEqual(
      SUPPORTED_CHAINS.map((chain) => chain.id),
    );

    for (const chain of SUPPORTED_CHAINS) {
      expect(CHAIN_NAMES[chain.id]).toBe(chain.name);
      expect(CHAINS_BY_ID[chain.id]?.id).toBe(chain.id);
    }
  });

  it("includes the networks surfaced by the headless SDK and widget UI", () => {
    expect(SUPPORTED_CHAIN_IDS).toEqual(
      expect.arrayContaining([
        1, 137, 42161, 8453, 84532, 10, 11155111, 59144, 59141, 143, 10143,
        4663, 4326, 5042002, 31337,
      ]),
    );
  });

  it("defines Alchemy slugs for supported Alchemy-backed RPC chains", () => {
    expect(ALCHEMY_CHAIN_SLUGS[84532]).toBe("base-sepolia");
    expect(ALCHEMY_CHAIN_SLUGS[59144]).toBe("linea-mainnet");
    expect(ALCHEMY_CHAIN_SLUGS[59141]).toBe("linea-sepolia");
    expect(ALCHEMY_CHAIN_SLUGS[4663]).toBe("robinhood-mainnet");
    expect(ALCHEMY_CHAIN_SLUGS[4326]).toBe("megaeth-mainnet");
  });

  it("defines the Robinhood Chain mainnet RPC and explorer", () => {
    expect(CHAINS_BY_ID[4663]).toMatchObject({
      id: 4663,
      name: "Robinhood Chain",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
      },
      blockExplorers: {
        default: {
          name: "Robinhood Chain Explorer",
          url: "https://robinhoodchain.blockscout.com",
        },
      },
    });
  });

  it("defines MegaETH mainnet metadata", () => {
    expect(CHAINS_BY_ID[4326]).toMatchObject({
      id: 4326,
      name: "MegaETH",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    });
  });

  it("defines Arc Testnet as a USDC-native EVM chain", () => {
    expect(CHAINS_BY_ID[5042002]).toMatchObject({
      id: 5042002,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
      rpcUrls: {
        default: {
          http: [
            "https://rpc.testnet.arc.io",
            "https://rpc.drpc.testnet.arc.io",
            "https://rpc.quicknode.testnet.arc.io",
          ],
        },
      },
      blockExplorers: {
        default: {
          name: "ArcScan",
          url: "https://testnet.arcscan.app",
        },
      },
      testnet: true,
    });
  });
});
