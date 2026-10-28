import type {
  AomiGuard,
  TransactionSafetyMode,
  TransactionSafetyPolicy,
} from "@aomi-labs/client";
import type { DisplayQuery } from "@aomi-labs/react";

/**
 * The account's default policy. Saves write it straight into the cache, so it
 * never goes stale on its own.
 */
export const accountSafetyQuery = (
  guard: AomiGuard,
): DisplayQuery<TransactionSafetyPolicy> => ({
  resource: "transaction-safety",
  parameters: ["account"],
  staleTime: Infinity,
  fetcher: () => guard.get(),
});

export function fetchTransactionSafety(
  guard: AomiGuard,
  threadId?: string,
): Promise<TransactionSafetyPolicy> {
  return guard.get({ thread: threadId });
}

export async function saveTransactionSafety(
  guard: AomiGuard,
  mode: TransactionSafetyMode,
  revision: number,
  threadId?: string,
): Promise<TransactionSafetyPolicy> {
  const policy = await guard.set({ mode, revision, thread: threadId });
  if (!threadId && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<TransactionSafetyPolicy>(DEFAULT_CHANGED_EVENT, {
        detail: policy,
      }),
    );
  }
  return policy;
}

/** A failure's own message when it has one, else the caller's wording. */
export function safetyErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

type TransactionSafetySave =
  | { ok: true; policy: TransactionSafetyPolicy }
  | { ok: false; error: unknown; latest?: TransactionSafetyPolicy };

/**
 * Save `mode` against `revision`. After a failure (usually a revision
 * conflict) read the latest policy instead; a write is never silently retried.
 */
export async function saveOrReloadTransactionSafety(
  guard: AomiGuard,
  mode: TransactionSafetyMode,
  revision: number,
  threadId?: string,
): Promise<TransactionSafetySave> {
  try {
    return {
      ok: true,
      policy: await saveTransactionSafety(guard, mode, revision, threadId),
    };
  } catch (error) {
    // Keep the original error if the re-read fails; admission stays
    // server-owned.
    const latest = await fetchTransactionSafety(guard, threadId).catch(
      () => undefined,
    );
    return { ok: false, error, latest };
  }
}

const DEFAULT_CHANGED_EVENT = "aomi:transaction-safety-default";

/** Follow account-default saves made elsewhere (e.g. Settings › Safety). */
export function onTransactionSafetyDefaultChange(
  listener: (policy: TransactionSafetyPolicy) => void,
): () => void {
  const handle = (event: Event) =>
    listener((event as CustomEvent<TransactionSafetyPolicy>).detail);
  window.addEventListener(DEFAULT_CHANGED_EVENT, handle);
  return () => window.removeEventListener(DEFAULT_CHANGED_EVENT, handle);
}
