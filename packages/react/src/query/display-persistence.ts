import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  displayKeyPrefix,
  type DisplayResource,
  type DisplayScope,
  type RuntimeAccount,
} from "./display-cache";

/**
 * What a runtime saves across reloads: nothing, the public catalogs, or the
 * public catalogs plus the signed-in user's display profile.
 */
export type DisplayPersistence = "none" | "public" | "account";

const MAX_AGE = 24 * 60 * 60_000;
const SCHEMA = "display-v3";
type SavedQuery = {
  resource: DisplayResource;
  parameters: unknown[];
  data: unknown;
  updatedAt: number;
};
export type SavedDisplayData = {
  schema: string;
  savedAt: number;
  accountId?: string;
  queries: SavedQuery[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pick(value: unknown, keys: readonly string[]) {
  const row = record(value);
  if (!row) return null;
  return Object.fromEntries(
    keys
      .filter(
        (key) =>
          ["string", "number", "boolean"].includes(typeof row[key]) ||
          (Array.isArray(row[key]) &&
            (row[key] as unknown[]).every(
              (item) => typeof item === "string" || typeof item === "number",
            )),
      )
      .map((key) => [key, row[key]]),
  );
}

const pickRows = (value: unknown, keys: readonly string[]) =>
  Array.isArray(value)
    ? value.map((row) => pick(row, keys)).filter(Boolean)
    : undefined;

/** The saved fields of each resource. Anything not listed here is never written. */
const SAVED_FIELDS: Partial<
  Record<DisplayResource, (value: unknown) => unknown>
> = {
  models: (value) =>
    Array.isArray(value) && value.every((model) => typeof model === "string")
      ? value
      : undefined,
  "app-catalog": (value) =>
    pickRows(value, [
      "name",
      "label",
      "description",
      "applicationId",
      "chainIds",
      "isPublic",
      "featureCatalog",
      "platform",
    ]),
  skills: (value) =>
    pickRows(value, [
      "id",
      "name",
      "description",
      "tags",
      "featureCatalog",
      "chainIds",
      "injectedTools",
      "estimatedTokens",
    ]),
  threads: (value) =>
    Array.isArray(value)
      ? value.flatMap((value) => {
          const row = pick(value, ["id", "title", "archived", "updatedAt"]);
          return typeof row?.id === "string" &&
            typeof row.title === "string" &&
            typeof row.archived === "boolean" &&
            typeof row.updatedAt === "number"
            ? [row]
            : [];
        })
      : undefined,
  profile: (value) => {
    const user = pick(record(value)?.user, [
      "user_id",
      "verified_email",
      "tier",
      "created_at",
    ]);
    return typeof user?.user_id === "string" ? { user } : undefined;
  },
};

export function savedDisplayData(resource: DisplayResource, value: unknown) {
  return SAVED_FIELDS[resource]?.(value);
}

export function snapshotDisplayData(
  client: QueryClient,
  prefix: QueryKey,
  accountId?: string,
): SavedDisplayData {
  const queries: SavedQuery[] = [];
  for (const query of client.getQueryCache().findAll({ queryKey: prefix })) {
    const resource = query.queryKey[prefix.length] as DisplayResource;
    if (query.state.status !== "success") continue;
    const data = savedDisplayData(resource, query.state.data);
    if (data === undefined) continue;
    queries.push({
      resource,
      parameters: query.queryKey.slice(prefix.length + 1),
      data,
      updatedAt: query.state.dataUpdatedAt,
    });
  }
  return { schema: SCHEMA, savedAt: Date.now(), accountId, queries };
}

export function restoreDisplayData(
  client: QueryClient,
  prefix: QueryKey,
  value: unknown,
  accountId?: string,
) {
  const saved = record(value);
  if (
    saved?.schema !== SCHEMA ||
    typeof saved.savedAt !== "number" ||
    Date.now() - saved.savedAt > MAX_AGE ||
    saved.accountId !== accountId ||
    !Array.isArray(saved.queries)
  )
    return;
  for (const entry of saved.queries) {
    const query = record(entry);
    if (
      !query ||
      typeof query.resource !== "string" ||
      typeof query.updatedAt !== "number" ||
      Date.now() - query.updatedAt > MAX_AGE ||
      !Array.isArray(query.parameters)
    )
      continue;
    const resource = query.resource as DisplayResource;
    const data = savedDisplayData(resource, query.data);
    if (data === undefined) continue;
    if (
      resource === "profile" &&
      record(record(data)?.user)?.user_id !== accountId
    )
      continue;
    const key = [...prefix, resource, ...query.parameters];
    if ((client.getQueryState(key)?.dataUpdatedAt ?? 0) >= query.updatedAt)
      continue;
    // A saved profile is a partial projection. The first live read must
    // fetch the full profile before ACL or installed-app views derive it.
    client.setQueryData(key, data, {
      updatedAt: resource === "profile" ? 0 : query.updatedAt,
    });
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("aomi-display-cache", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Display cache unavailable"));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction("snapshots", mode);
    const request = run(transaction.objectStore("snapshots"));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

/** Where saved copies live. IndexedDB in browsers; tests pass a map. */
export type SavedCopyStore = {
  get(key: string): Promise<unknown>;
  put(key: string, value: SavedDisplayData): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};

const indexedDbStore: SavedCopyStore = {
  get: (key) => transact("readonly", (store) => store.get(key)),
  put: (key, value) => transact("readwrite", (store) => store.put(value, key)),
  delete: (key) => transact("readwrite", (store) => store.delete(key)),
};

/**
 * Keep one saved copy in step with the cache. Writes are batched to at most
 * one a second and stop for good once the returned cleanup runs.
 */
function syncSavedCopy(
  store: SavedCopyStore,
  client: QueryClient,
  storageKey: string,
  prefix: QueryKey,
  accountId?: string,
) {
  let active = true;
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    if (!active || !ready || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!active) return;
      void store
        .put(storageKey, snapshotDisplayData(client, prefix, accountId))
        .catch(() => {});
    }, 1_000);
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (
      active &&
      ready &&
      event.type === "removed" &&
      event.query.queryKey[prefix.length] === "threads"
    ) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      void store
        .put(storageKey, snapshotDisplayData(client, prefix, accountId))
        .catch(() => {});
    } else save();
  });
  void store
    .get(storageKey)
    .then((saved) => {
      if (!active) return;
      if (accountId && record(saved)?.accountId !== accountId) {
        void store.delete(storageKey).catch(() => {});
        return;
      }
      restoreDisplayData(client, prefix, saved, accountId);
    })
    .catch(() => {})
    .finally(() => {
      ready = true;
      // Overwrites a copy that belonged to another account straight away.
      save();
    });
  return () => {
    active = false;
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

export function persistDisplayCache(
  client: QueryClient,
  scope: DisplayScope,
  persistence: DisplayPersistence,
  store: SavedCopyStore | null = typeof indexedDB === "undefined"
    ? null
    : indexedDbStore,
  onRestoredAccount?: (account: RuntimeAccount) => void,
): () => void {
  if (persistence === "none" || !store) return () => {};
  const storageKey = (slot: string) =>
    JSON.stringify([SCHEMA, scope.backendUrl, scope.appId, slot]);
  const stopPublic = syncSavedCopy(
    store,
    client,
    storageKey("public"),
    displayKeyPrefix(scope, "public"),
  );
  if (persistence !== "account") return stopPublic;
  if (scope.account === undefined) {
    let active = true;
    void store
      .get(storageKey("account"))
      .then((value) => {
        const saved = record(value);
        if (!active || typeof saved?.accountId !== "string") return;
        const account: RuntimeAccount = { kind: "user", id: saved.accountId };
        const prefix = displayKeyPrefix(scope, account);
        // Pending identity may preview only the saved list, never account policy.
        restoreDisplayData(
          client,
          prefix,
          {
            ...saved,
            queries: Array.isArray(saved.queries)
              ? saved.queries.filter(
                  (entry) => record(entry)?.resource === "threads",
                )
              : [],
          },
          account.id,
        );
        if (client.getQueryData([...prefix, "threads"]) !== undefined)
          onRestoredAccount?.(account);
      })
      .catch(() => {});
    return () => {
      active = false;
      stopPublic();
    };
  }
  const user = scope.account?.kind === "user" ? scope.account : null;
  if (!user) {
    // Signed out (here or in another tab): nobody's profile stays on disk.
    void store.delete(storageKey("account")).catch(() => {});
    return stopPublic;
  }
  const stopAccount = syncSavedCopy(
    store,
    client,
    storageKey("account"),
    displayKeyPrefix(scope, user),
    user.id,
  );
  return () => {
    stopPublic();
    stopAccount();
  };
}
