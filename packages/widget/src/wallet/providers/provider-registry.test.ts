import { describe, expect, it } from "vitest";
import type { AomiWalletKitProviderInput } from "@/wallet/config/types";
import {
  detectProviderSugar,
  getWalletProvider,
  registerWalletProvider,
  type WalletProviderAdapter,
} from "./provider-registry";

const asInput = (value: unknown) => value as AomiWalletKitProviderInput;

describe("wallet provider adapter registry", () => {
  it("resolves a registered provider by id", () => {
    const adapter = {
      id: "reg-a",
      wrap: ({ children }) => children,
    } satisfies WalletProviderAdapter;
    registerWalletProvider(adapter);
    expect(getWalletProvider("reg-a")).toBe(adapter);
    expect(getWalletProvider("reg-missing")).toBeUndefined();
  });

  it("normalizes input through the matching sugar detector", () => {
    registerWalletProvider({
      id: "sugar-x",
      detectSugar: (input) =>
        (input as { kind?: string }).kind === "x"
          ? { children: null, preset: "wallets-only" }
          : null,
    });
    expect(detectProviderSugar(asInput({ kind: "x" }))).toEqual({
      children: null,
      preset: "wallets-only",
    });
  });

  it("returns null when no registered detector matches", () => {
    expect(detectProviderSugar(asInput({ kind: "nope" }))).toBeNull();
  });
});
