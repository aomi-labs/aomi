import type { AomiOAuthGrant } from "../authorization";

/** Structured cloning keeps private keys non-exportable; credentials never enter URLs or localStorage. */
export function browserGrantStorage(key: string) {
  type Saved = { grants: AomiOAuthGrant[]; keys: Map<string, CryptoKeyPair> };
  async function transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("aomi-browser-grants", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("sessions");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction("sessions", mode);
        const request = action(tx.objectStore("sessions"));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error ?? new Error("Session storage aborted"));
      });
    } finally {
      db.close();
    }
  }
  return {
    load: () =>
      transaction<Saved | undefined>("readonly", (store) => store.get(key)),
    save: (value: Saved | null) =>
      value
        ? transaction("readwrite", (store) => store.put(value, key))
        : transaction("readwrite", (store) => store.delete(key)),
  };
}
