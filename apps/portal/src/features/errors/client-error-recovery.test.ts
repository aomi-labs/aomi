import { describe, expect, it } from "vitest";

import {
  claimClientReload,
  isRecoverableClientError,
} from "./client-error-recovery";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("client error recovery", () => {
  it.each([
    new Error("Load failed"),
    new Error("Loading chunk 123 failed"),
    new TypeError("Failed to fetch dynamically imported module"),
    new TypeError("Importing a module script failed"),
  ])("recognizes browser module loading failures", (error) => {
    expect(isRecoverableClientError(error)).toBe(true);
  });

  it("does not reload for an application exception", () => {
    expect(isRecoverableClientError(new Error("Invalid wallet state"))).toBe(
      false,
    );
  });

  it("allows one automatic reload per cooldown", () => {
    const storage = memoryStorage();

    expect(claimClientReload(storage, 1_000)).toBe(true);
    expect(claimClientReload(storage, 2_000)).toBe(false);
    expect(claimClientReload(storage, 61_000)).toBe(true);
  });

  it("fails closed when Safari storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };

    expect(claimClientReload(storage)).toBe(false);
  });
});
