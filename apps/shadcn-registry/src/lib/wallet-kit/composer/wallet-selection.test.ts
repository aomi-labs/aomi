import { describe, expect, it } from "vitest";
import {
  readWalletSelection,
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
