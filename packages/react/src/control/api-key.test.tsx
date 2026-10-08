import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { createScopedStorage } from "@aomi-labs/client";
import { useApiKeyImpl } from "./api-key";
const scope = { backendUrl: "https://api.example", appId: "one" };
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
it("holds keys in memory, consumes and deletes the plaintext legacy value", () => {
  localStorage.setItem("aomi_secret_key", "legacy");
  const hook = renderHook(() => useApiKeyImpl(scope));
  expect(hook.result.current.state.apiKey).toBe("legacy");
  expect(localStorage.getItem("aomi_secret_key")).toBeNull();
  act(() => hook.result.current.actions.setApiKey("new"));
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it("only persists into scoped session storage on explicit opt-in", () => {
  const hook = renderHook(() => useApiKeyImpl(scope, "session"));
  act(() => hook.result.current.actions.setApiKey("secret"));
  const storage = createScopedStorage(scope, { storage: sessionStorage });
  expect(storage.get("apiKey")).toBe("secret");
  expect(localStorage.length).toBe(0);
  hook.unmount();
  const restored = renderHook(() => useApiKeyImpl(scope, "session"));
  expect(restored.result.current.state.apiKey).toBe("secret");
  act(() => restored.result.current.actions.setApiKey(null));
  expect(storage.get("apiKey")).toBeNull();
});
