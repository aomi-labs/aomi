// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { browserGrantStorage } from "./browser-grant-storage";

afterEach(() => vi.unstubAllGlobals());

it("allows an empty restore when storage is unavailable but surfaces write and deletion failures", async () => {
  vi.stubGlobal("indexedDB", {
    open: () => {
      throw new Error("Storage denied");
    },
  });
  const storage = browserGrantStorage("test-session");
  await expect(storage.load()).resolves.toBeUndefined();
  await expect(storage.save({ grants: [], keys: new Map() })).rejects.toThrow(
    "Storage denied",
  );
  await expect(storage.save(null)).rejects.toThrow("Storage denied");
});
