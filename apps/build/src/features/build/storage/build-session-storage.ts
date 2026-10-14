import {
  seedBuildSessions,
  type BuildSession,
} from "@/features/build/contracts";
import {
  sanitizeBuildSession,
  sessionsNeedSanitize,
} from "@/features/build/storage/sanitize-session-copy";

// v2: artifacts became Rust-crate shaped (P0) — v1 sessions carry the old
// TypeScript-mock trees/copy and would resurface stale fiction on load.
const STORAGE_KEY = "aomi-build-sessions-v2";
const LEGACY_STORAGE_KEYS = ["aomi-build-sessions-v1"];
const sessionListeners = new Set<() => void>();
let didRewriteSanitized = false;

function emitBuildSessionsChange() {
  sessionListeners.forEach((listener) => listener());
}

export function subscribeBuildSessions(onStoreChange: () => void) {
  sessionListeners.add(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    sessionListeners.delete(onStoreChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export const emptySessions: BuildSession[] = [];

// getSnapshot must return a stable reference between store changes,
// so cache the parsed sessions keyed on the raw localStorage string.
let sessionsCache: { raw: string | null; value: BuildSession[] } | null = null;

export function loadPersistedSessions(): BuildSession[] {
  if (typeof window === "undefined") return emptySessions;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Best-effort cleanup; a blocked removal just leaves dead data behind.
    }
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (sessionsCache && sessionsCache.raw === raw) return sessionsCache.value;

  let value = emptySessions;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as BuildSession[];
      value = Array.isArray(parsed) ? parsed : emptySessions;
    } catch {
      value = emptySessions;
    }
  }

  if (value.length > 0) {
    const cleaned = value.map(sanitizeBuildSession);
    if (sessionsNeedSanitize(value)) {
      value = cleaned;
      if (!didRewriteSanitized) {
        didRewriteSanitized = true;
        const nextRaw = JSON.stringify(cleaned);
        queueMicrotask(() => {
          localStorage.setItem(STORAGE_KEY, nextRaw);
          sessionsCache = { raw: nextRaw, value: cleaned };
          emitBuildSessionsChange();
        });
      }
    }
  }

  sessionsCache = { raw, value };
  return value;
}

export function savePersistedSession(session: BuildSession) {
  const cleaned = sanitizeBuildSession(session);
  const existing = loadPersistedSessions().filter((s) => s.id !== cleaned.id);
  const next = [cleaned, ...existing].slice(0, 20);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  emitBuildSessionsChange();
}

export function mergeSessions(persisted: BuildSession[]): BuildSession[] {
  const persistedIds = new Set(persisted.map((s) => s.id));
  const seeded = seedBuildSessions.filter((s) => !persistedIds.has(s.id));
  return [...persisted, ...seeded];
}

export function findSessionById(
  id: string,
  persisted: BuildSession[],
): BuildSession | undefined {
  return (
    persisted.find((s) => s.id === id) ??
    seedBuildSessions.find((s) => s.id === id)
  );
}
