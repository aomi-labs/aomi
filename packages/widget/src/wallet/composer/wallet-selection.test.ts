import { describe, expect, it } from "vitest";
import {
  readWalletSelection,
  selectedWalletKeys,
  writeWalletSelection,
  type WalletSelectionStorage,
} from "./wallet-selection";

function testStorage() {
  const values = new Map<string, string>();
  const storage: WalletSelectionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  return { storage, values };
}

describe("wallet selection storage", () => {
  it("makes a newly connected linked wallet active without selecting an unlinked one", () => {
    const active = {
      evm: { address: "0xBB" },
      svm: { address: "unlinked" },
    };
    const stored = { evm: "evm:0xaa", svm: "svm:linked" };
    const linked = [
      { family: "evm" as const, address: "0xAA" },
      { family: "evm" as const, address: "0xBB" },
      { family: "svm" as const, address: "linked" },
    ];

    expect(selectedWalletKeys(stored, active, linked)).toEqual({
      evm: "evm:0xbb",
      svm: "svm:linked",
    });
    expect(selectedWalletKeys(stored, active)).toEqual({
      evm: "evm:0xbb",
      svm: "svm:unlinked",
    });
  });

  it("isolates selections by account and family", () => {
    const { storage } = testStorage();
    writeWalletSelection(storage, "account-a", "evm", "evm:0xaa");
    writeWalletSelection(storage, "account-a", "svm", "svm:abc");
    writeWalletSelection(storage, "account-b", "evm", "evm:0xbb");

    expect(readWalletSelection(storage, "account-a")).toEqual({
      evm: "evm:0xaa",
      svm: "svm:abc",
    });
    expect(readWalletSelection(storage, "account-b")).toEqual({
      evm: "evm:0xbb",
    });
  });

  it("clears only the invalid family selection", () => {
    const { storage } = testStorage();
    writeWalletSelection(storage, "account-a", "evm", "evm:0xaa");
    writeWalletSelection(storage, "account-a", "svm", "svm:abc");
    writeWalletSelection(storage, "account-a", "evm", undefined);

    expect(readWalletSelection(storage, "account-a")).toEqual({
      svm: "svm:abc",
    });
  });

  it("fails open to an empty preference when storage is unavailable", () => {
    const broken: WalletSelectionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readWalletSelection(broken, "account-a")).toEqual({});
    expect(() =>
      writeWalletSelection(broken, "account-a", "evm", "evm:0xaa"),
    ).not.toThrow();
  });
});
