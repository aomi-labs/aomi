import { describe, expect, it } from "vitest";
import { modeHintFor } from "./account-reconcile";
import { normalizeSignerMode } from "./account-api";
import type { WalletPolicy } from "./types";

function wallet(overrides: Partial<WalletPolicy>): WalletPolicy {
  return {
    id: "evm:0xalice",
    chain: "evm",
    address: "0xAlice",
    linkedVia: "privy",
    desiredMode: "manual",
    authVersion: 0,
    ...overrides,
  };
}

describe("modeHintFor", () => {
  it("says manual always requires Alice's popup", () => {
    expect(modeHintFor(wallet({}), "manual")).toContain("wallet popup");
    expect(modeHintFor(wallet({}), "manual")).toContain("cannot sign");
  });

  it("keeps Privy Auto on Alice's same delegated wallet", () => {
    expect(modeHintFor(wallet({ linkedVia: "privy" }), "auto")).toContain(
      "same wallet",
    );
  });

  it("shows that Para Auto uses a separate agent address", () => {
    expect(
      modeHintFor(wallet({ linkedVia: "para", providerManaged: true }), "auto"),
    ).toContain("separate Para agent wallet");
  });

  it("does not imply the Para login wallet can be delegated", () => {
    expect(
      modeHintFor(
        wallet({ linkedVia: "para", providerManaged: false }),
        "auto",
      ),
    ).toContain("cannot delegate this login wallet");
  });
});

describe("normalizeSignerMode", () => {
  it("maps only the canonical ladder spellings; everything else fails closed", () => {
    expect(normalizeSignerMode("server_auto")).toBe("auto");
    expect(normalizeSignerMode("client_auto")).toBe("client_auto");
    expect(normalizeSignerMode("denied")).toBe("denied");
    expect(normalizeSignerMode("manual")).toBe("manual");
    // The canonical account DTO names the server-controlled mode `auto`.
    expect(normalizeSignerMode("auto")).toBe("auto");
    expect(normalizeSignerMode("agent_sync")).toBe("denied");
  });
});
