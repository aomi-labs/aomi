"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAomiDisplayCache } from "@aomi-labs/react";
import type { WalletFamily } from "@/wallet/types";

/**
 * What the account chip needs for its first paint, saved per backend and app
 * so a reload shows the account at once while the session is confirmed. It
 * holds display data only, never a credential.
 */
export type AccountSnapshot = {
  accountId: string;
  name: string;
  wallets: { family: WalletFamily; address: string; brand: string }[];
};

const PREFIX = "aomi:account-chip:";
const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; value: AccountSnapshot | null } =
  { key: "", raw: null, value: null };

function read(key: string): AccountSnapshot | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (cache.key === key && cache.raw === raw) return cache.value;
  let value: AccountSnapshot | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as AccountSnapshot) : null;
    value =
      parsed &&
      typeof parsed.accountId === "string" &&
      typeof parsed.name === "string" &&
      Array.isArray(parsed.wallets)
        ? parsed
        : null;
  } catch {
    value = null;
  }
  cache = { key, raw, value };
  return value;
}

function write(key: string, value: AccountSnapshot | null) {
  try {
    const next = value ? JSON.stringify(value) : null;
    if (window.localStorage.getItem(key) === next) return;
    if (next) window.localStorage.setItem(key, next);
    else window.localStorage.removeItem(key);
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useAccountSnapshot(): [
  AccountSnapshot | null,
  (value: AccountSnapshot | null) => void,
] {
  const scope = useAomiDisplayCache()?.scope;
  const key = `${PREFIX}${scope ? `${scope.backendUrl}|${scope.appId}` : "default"}`;
  const snapshot = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const save = useCallback(
    (value: AccountSnapshot | null) => write(key, value),
    [key],
  );
  return [snapshot, save];
}
