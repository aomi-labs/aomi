import { beforeEach, expect, it } from "vitest";
import { PrivateAppStore } from "./private-apps";
const app = (id: number) => ({ name: "same-name", applicationId: id, isPublic: false });
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
it("keeps two same-name applications separate, updates duplicates, and removes only the chosen credential", () => {
  const store = new PrivateAppStore();
  store.add(app(7), "key-one"); store.add(app(8), "key-two");
  store.add(app(7), "rotated-one");
  expect(store.snapshot()).toHaveLength(2);
  expect(store.getKey("7")).toBe("rotated-one");
  expect(store.getKey(8)).toBe("key-two");
  expect(store.getKey(9)).toBeUndefined();
  expect(JSON.stringify(store.snapshot())).not.toContain("key-");
  store.remove(7);
  expect(store.getKey(7)).toBeUndefined();
  expect(store.getKey(8)).toBe("key-two");
  expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
});
it("restores opted-in tab storage only for the same backend and account", () => {
  const store = new PrivateAppStore(); store.persist("https://api.one", "user:alice");
  store.add(app(7), "secret");
  const restored = new PrivateAppStore(); restored.persist("https://api.one", "user:alice");
  expect(restored.getKey(7)).toBe("secret");
  const other = new PrivateAppStore(); other.persist("https://api.one", "user:bob");
  expect(other.getKey(7)).toBeUndefined();
  const otherBackend = new PrivateAppStore(); otherBackend.persist("https://api.two", "user:alice");
  expect(otherBackend.getKey(7)).toBeUndefined();
  expect(localStorage.length).toBe(0);
});
