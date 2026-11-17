"use client";

const THREAD_PERSISTENCE_KEY_PREFIX = "aomi:lastThread";
const DEFAULT_SCOPE = "default";

type ThreadPersistenceKeyOptions = {
  backendUrl: string;
  agent?: number | string | null;
  scope?: string | null;
};

const normalizeKeyPart = (value: unknown): string => {
  if (value === null || value === undefined) return DEFAULT_SCOPE;
  const text = String(value).trim();
  return text.length > 0 ? text : DEFAULT_SCOPE;
};

export function buildThreadPersistenceKey({
  backendUrl,
  agent,
  scope,
}: ThreadPersistenceKeyOptions): string {
  return [
    THREAD_PERSISTENCE_KEY_PREFIX,
    normalizeKeyPart(backendUrl),
    normalizeKeyPart(agent),
    normalizeKeyPart(scope),
  ].join(":");
}

export function readPersistedThreadId(storageKey: string): string | null {
  try {
    const threadId = globalThis.localStorage?.getItem(storageKey)?.trim();
    return threadId && threadId.length > 0 ? threadId : null;
  } catch {
    return null;
  }
}

export function writePersistedThreadId(
  storageKey: string,
  threadId: string,
): void {
  try {
    globalThis.localStorage?.setItem(storageKey, threadId);
  } catch {
    // Storage can be unavailable in private browsing, SSR previews, or tests.
  }
}

export function clearPersistedThreadId(storageKey: string): void {
  try {
    globalThis.localStorage?.removeItem(storageKey);
  } catch {
    // Storage can be unavailable in private browsing, SSR previews, or tests.
  }
}
