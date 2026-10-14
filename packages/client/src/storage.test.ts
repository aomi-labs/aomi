import { describe, expect, it } from "vitest";
import { createScopedStorage } from "./storage";

describe("scoped preference storage", () => {
  it("isolates backend, app and principal and normalizes URL origins", () => {
    localStorage.clear();
    const first = createScopedStorage({
      backendUrl: "https://API.example/",
      appId: "one",
    });
    const same = createScopedStorage({
      backendUrl: "https://api.example",
      appId: "one",
    });
    const second = createScopedStorage({
      backendUrl: "https://api.example",
      appId: "two",
    });
    const otherBackend = createScopedStorage({
      backendUrl: "https://other.example",
      appId: "one",
    });
    first.set("settings", "saved");
    expect(same.get("settings")).toBe("saved");
    expect(second.get("settings")).toBeNull();
    expect(otherBackend.get("settings")).toBeNull();
    expect(first.withPrincipal("alice").key("settings")).not.toBe(
      first.withPrincipal("bob").key("settings"),
    );
  });
  it("copies then deletes a legacy key and preserves existing scoped data", () => {
    localStorage.clear();
    localStorage.setItem("old", "carried over");
    const storage = createScopedStorage({
      backendUrl: "https://api.example",
      appId: "one",
    });
    expect(storage.migrate("settings", "old")).toBe("carried over");
    expect(localStorage.getItem("old")).toBeNull();
    localStorage.setItem("old", "stale");
    expect(storage.migrate("settings", "old")).toBe("carried over");
  });
  it("handles unavailable storage and malformed JSON", () => {
    const storage = createScopedStorage({ backendUrl: "" }, { storage: null });
    expect(storage.get("anything")).toBeNull();
    expect(() => storage.set("anything", "value")).not.toThrow();
    const denied = createScopedStorage(
      { backendUrl: "" },
      {
        storage: {
          getItem() {
            throw Error("denied");
          },
          setItem() {
            throw Error("denied");
          },
          removeItem() {
            throw Error("denied");
          },
        } as unknown as Storage,
      },
    );
    expect(denied.get("anything")).toBeNull();
    expect(() => denied.set("anything", "value")).not.toThrow();
    const json = createScopedStorage({ backendUrl: "" });
    json.set("json", "{");
    expect(
      json.getJson("json", (value): value is object => Boolean(value)),
    ).toBeNull();
  });
});
