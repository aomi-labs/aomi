import { describe, expect, it, vi } from "vitest";
import {
  createDisplayQueryClient,
  displayKey,
  displayKeyPrefix,
  type DisplayScope,
} from "./display-cache";
import {
  persistDisplayCache,
  restoreDisplayData,
  savedDisplayData,
  snapshotDisplayData,
  type SavedCopyStore,
} from "./display-persistence";

function memoryStore(entries: Record<string, unknown> = {}) {
  const saved = new Map(Object.entries(entries));
  const store: SavedCopyStore = {
    get: async (key) => saved.get(key),
    put: async (key, value) => saved.set(key, value),
    delete: async (key) => saved.delete(key),
  };
  return { saved, store };
}
const accountSlot = JSON.stringify(["display-v3", "/backend", "8", "account"]);

const user = { kind: "user", id: "a" } as const;
const scope: DisplayScope = {
  backendUrl: "/backend",
  appId: "8",
  account: user,
};
const accountPrefix = displayKeyPrefix(scope, user);
const publicPrefix = displayKeyPrefix(scope, "public");

describe("what the display cache saves", () => {
  it("saves listed profile fields only; never credentials, policies, signing, credits or messages", () => {
    const client = createDisplayQueryClient();
    client.setQueryData(displayKey(scope, "profile"), {
      user: {
        user_id: "a",
        tier: "pro",
        credential: "secret",
        private_key: "key",
        apps: ["private"],
      },
      pendingActions: ["sign"],
      signing_policies: ["allow"],
    });
    client.setQueryData(displayKey(scope, "credits"), { receipt: "proof" });
    client.setQueryData([...accountPrefix, "messages"], ["private message"]);
    const saved = snapshotDisplayData(client, accountPrefix, "a");
    expect(saved.queries.map((query) => query.data)).toEqual([
      { user: { user_id: "a", tier: "pro" } },
    ]);
    expect(snapshotDisplayData(client, publicPrefix).queries).toEqual([]);
  });

  it.each([
    [
      "skills",
      [{ id: "swap", name: "Swap", instructions: "secret" }],
      [{ id: "swap", name: "Swap" }],
    ],
    ["models", ["model-a"], ["model-a"]],
    ["account-acl", { allow: true }, undefined],
    ["credits", { balance: 1 }, undefined],
  ] as const)("saves %s as %j", (resource, value, expected) => {
    expect(savedDisplayData(resource, value)).toEqual(expected);
  });

  it("shows a saved profile at once but still reads the full profile", async () => {
    const original = createDisplayQueryClient();
    original.setQueryData(displayKey(scope, "profile"), {
      user: { user_id: "a", tier: "pro" },
      signing_policies: ["private"],
    });
    const restored = createDisplayQueryClient();
    restoreDisplayData(
      restored,
      accountPrefix,
      snapshotDisplayData(original, accountPrefix, "a"),
      "a",
    );
    expect(restored.getQueryData(displayKey(scope, "profile"))).toEqual({
      user: { user_id: "a", tier: "pro" },
    });
    const full = { user: { user_id: "a" }, signing_policies: [] };
    await restored.fetchQuery({
      queryKey: displayKey(scope, "profile"),
      queryFn: async () => full,
    });
    expect(restored.getQueryData(displayKey(scope, "profile"))).toEqual(full);
  });

  it("ignores old schemas, another account's copy, and copies older than live data", () => {
    const old = createDisplayQueryClient();
    old.setQueryData(
      displayKey(scope, "profile"),
      { user: { user_id: "a", tier: "free" } },
      { updatedAt: Date.now() - 1000 },
    );
    const saved = snapshotDisplayData(old, accountPrefix, "a");
    const otherScope: DisplayScope = {
      ...scope,
      account: { kind: "user", id: "b" },
    };
    const other = createDisplayQueryClient();
    const otherPrefix = displayKeyPrefix(otherScope, otherScope.account!);
    restoreDisplayData(other, otherPrefix, saved, "b");
    expect(other.getQueryCache().getAll()).toHaveLength(0);

    const current = createDisplayQueryClient();
    current.setQueryData(displayKey(scope, "profile"), {
      user: { user_id: "a", tier: "pro" },
    });
    restoreDisplayData(current, accountPrefix, saved, "a");
    expect(current.getQueryData(displayKey(scope, "profile"))).toEqual({
      user: { user_id: "a", tier: "pro" },
    });

    const blank = createDisplayQueryClient();
    restoreDisplayData(
      blank,
      accountPrefix,
      { ...saved, schema: "display-v1" },
      "a",
    );
    expect(blank.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("saved account data on start", () => {
  const savedProfile = (id: string) => {
    const client = createDisplayQueryClient();
    const owner = { kind: "user", id } as const;
    const prefix = displayKeyPrefix({ ...scope, account: owner }, owner);
    client.setQueryData([...prefix, "profile"], { user: { user_id: id } });
    return snapshotDisplayData(client, prefix, id);
  };

  it("restores the signed-in user's own copy", async () => {
    const { store } = memoryStore({ [accountSlot]: savedProfile("a") });
    const client = createDisplayQueryClient();
    const stop = persistDisplayCache(client, scope, "account", store);
    await vi.waitFor(() =>
      expect(client.getQueryData(displayKey(scope, "profile"))).toEqual({
        user: { user_id: "a" },
      }),
    );
    stop();
  });

  it("replaces another user's copy instead of restoring it", async () => {
    const { saved, store } = memoryStore({ [accountSlot]: savedProfile("b") });
    const client = createDisplayQueryClient();
    const stop = persistDisplayCache(client, scope, "account", store);
    await vi.waitFor(
      () =>
        expect(
          (saved.get(accountSlot) as { accountId?: string }).accountId,
        ).toBe("a"),
      { timeout: 2_000 },
    );
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    stop();
  });

  it.each([null, { kind: "guest", id: "g" } as const])(
    "deletes the saved account copy when nobody is signed in (%j)",
    async (account) => {
      const { saved, store } = memoryStore({
        [accountSlot]: savedProfile("a"),
      });
      const stop = persistDisplayCache(
        createDisplayQueryClient(),
        { ...scope, account },
        "account",
        store,
      );
      await vi.waitFor(() => expect(saved.has(accountSlot)).toBe(false));
      stop();
    },
  );

  it("leaves the saved copy alone while the account is still unknown", async () => {
    const { saved, store } = memoryStore({ [accountSlot]: savedProfile("a") });
    const client = createDisplayQueryClient();
    const stop = persistDisplayCache(
      client,
      { ...scope, account: undefined },
      "account",
      store,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved.has(accountSlot)).toBe(true);
    expect(client.getQueryData(displayKey(scope, "profile"))).toBeUndefined();
    stop();
  });
});
