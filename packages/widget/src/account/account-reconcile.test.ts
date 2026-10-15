import { describe, expect, it } from "vitest";
import {
  modeHintFor,
  modeLabel,
  signingChoicesFor,
  unavailableReason,
} from "@/account/account-reconcile";
import { normalizeSignerMode } from "@/account/account-api";
import type { WalletPolicy } from "@/account/types";

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
    expect(modeHintFor("manual")).toContain("wallet popup");
    expect(modeHintFor("manual")).toContain("cannot sign");
  });

  it("says Locked stops the wallet signing", () => {
    expect(modeHintFor("denied")).toContain("cannot sign");
  });
});

describe("signingChoicesFor", () => {
  it("offers Ask me and Locked to every wallet that holds a user key", () => {
    for (const linkedVia of ["privy", "para", "siwe", "siws"] as const) {
      expect(signingChoicesFor(wallet({ linkedVia }))).toEqual([
        "manual",
        "denied",
      ]);
    }
  });

  it("only lets a provider-managed agent wallet be locked", () => {
    expect(
      signingChoicesFor(wallet({ linkedVia: "para", providerManaged: true })),
    ).toEqual(["denied"]);
  });

  it("never offers Automatic", () => {
    expect(unavailableReason(wallet({}), "auto")).toContain(
      "can't be turned on",
    );
    expect(modeLabel("auto")).toBe("Automatic");
  });
});

describe("normalizeSignerMode", () => {
  it("maps only the canonical ladder spellings; everything else fails closed", () => {
    expect(normalizeSignerMode("server_auto")).toBe("auto");
    expect(normalizeSignerMode("denied")).toBe("denied");
    expect(normalizeSignerMode("manual")).toBe("manual");
    // The canonical account DTO names the server-controlled mode `auto`.
    expect(normalizeSignerMode("auto")).toBe("auto");
    expect(normalizeSignerMode("agent_sync")).toBe("denied");
  });

  it("reads a retired client_auto row as Ask me, like the backend", () => {
    expect(normalizeSignerMode("client_auto")).toBe("manual");
  });
});
