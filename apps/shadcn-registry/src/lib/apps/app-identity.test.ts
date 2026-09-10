import { describe, expect, it } from "vitest";

import {
  CURATED_APP_IDS,
  canonicalAppId,
  resolveAppIdentity,
} from "./app-identity";

describe("app identity", () => {
  it("uses one canonical key for case, whitespace, and known aliases", () => {
    expect(canonicalAppId("  LI_FI ")).toBe("lifi");
    expect(canonicalAppId("POLYMARKET_REWARDS")).toBe("polymarket-rewards");
    expect(canonicalAppId("para_consumer")).toBe("para-consumer");
    expect(canonicalAppId("para_customer")).toBe("para");
    expect(canonicalAppId("0X")).toBe("zerox");
  });

  it("preserves wire identity and hosted scope while curating known names", () => {
    expect(
      resolveAppIdentity({
        name: " POLYMARKET_REWARDS ",
        label: "messy backend rewards label",
        applicationId: 42,
      }),
    ).toMatchObject({
      id: " POLYMARKET_REWARDS ",
      brandId: "polymarket-rewards",
      displayName: "Polymarket Rewards",
      applicationId: 42,
    });

    expect(resolveAppIdentity("para").displayName).toBe("Para");
    expect(resolveAppIdentity("para_consumer").displayName).toBe(
      "Para Consumer",
    );
  });

  it("keeps private publishers custom even when their wire id matches a brand", () => {
    expect(
      resolveAppIdentity({
        name: "github",
        label: "  Internal GitHub Review  ",
        applicationId: 71,
        isPublic: false,
      }),
    ).toMatchObject({
      id: "github",
      brandId: "",
      displayName: "Internal GitHub Review",
      applicationId: 71,
    });
  });

  it("uses publisher labels only for unknown apps, then humanizes the id", () => {
    expect(
      resolveAppIdentity({ name: "partner-agent", label: "  Partner Lab  " }),
    ).toMatchObject({
      id: "partner-agent",
      brandId: "partner-agent",
      displayName: "Partner Lab",
      abbr: "PL",
    });
    expect(
      resolveAppIdentity({ name: "partner-agent", label: "   " }).displayName,
    ).toBe("Partner Agent");
    expect(resolveAppIdentity("constructor")).toMatchObject({
      id: "constructor",
      brandId: "constructor",
      displayName: "Constructor",
    });
  });

  it("includes Portal decorations and the live built-in catalog", () => {
    expect(CURATED_APP_IDS).toEqual(
      expect.arrayContaining([
        "aave",
        "auto",
        "birdeye",
        "cambrian",
        "coingecko",
        "default",
        "etherscan",
        "github",
        "jupiter",
        "krexa",
        "linear",
        "marinade",
        "morpho-vaults",
        "notion",
        "slack",
        "solscan",
        "stablefx",
        "svm",
        "svm-transfer",
        "uniswap",
        "vaultsfyi",
        "world-markets",
      ]),
    );
  });
});
