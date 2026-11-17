import { beforeEach, expect, it } from "vitest";
import { PrivateAgentStore } from "./private-agents";
const agent = (id: number) => ({
  agent_id: id,
  agent: `publisher${id}/same-name`,
  display_name: "same-name",
  metadata: {},
});
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
it("keeps two same-name agents separate, updates duplicates, and removes only the chosen credential", () => {
  const store = new PrivateAgentStore();
  store.add(agent(7), "key-one");
  store.add(agent(8), "key-two");
  store.add(agent(7), "rotated-one");
  expect(store.snapshot()).toHaveLength(2);
  expect(store.getKey(`publisher7/same-name`)).toBe("rotated-one");
  expect(store.getKey(`publisher8/same-name`)).toBe("key-two");
  expect(store.getKey(`publisher9/same-name`)).toBeUndefined();
  expect(JSON.stringify(store.snapshot())).not.toContain("key-");
  store.remove(`publisher7/same-name`);
  expect(store.getKey(`publisher7/same-name`)).toBeUndefined();
  expect(store.getKey(`publisher8/same-name`)).toBe("key-two");
  expect(sessionStorage.length).toBe(0);
  expect(localStorage.length).toBe(0);
});
it("restores opted-in tab storage only for the same backend and account", () => {
  const store = new PrivateAgentStore();
  store.persist("https://api.one", "user:alice");
  store.add(agent(7), "secret");
  const restored = new PrivateAgentStore();
  restored.persist("https://api.one", "user:alice");
  expect(restored.getKey(`publisher7/same-name`)).toBe("secret");
  const other = new PrivateAgentStore();
  other.persist("https://api.one", "user:bob");
  expect(other.getKey(`publisher7/same-name`)).toBeUndefined();
  const otherBackend = new PrivateAgentStore();
  otherBackend.persist("https://api.two", "user:alice");
  expect(otherBackend.getKey(`publisher7/same-name`)).toBeUndefined();
  expect(localStorage.length).toBe(0);
});
