import { transactionSafetyPolicy } from "@aomi-labs/client";
import type {
  TransactionSafetyMode,
  TransactionSafetyPolicy,
} from "@aomi-labs/client";
import type { ShellRequest } from "@/account/transport";

export async function fetchTransactionSafety(
  request: ShellRequest,
  threadId?: string,
): Promise<TransactionSafetyPolicy> {
  return transactionSafetyPolicy(
    await request(
      threadId
        ? "/api/thread/transaction-safety"
        : "/api/account/transaction-safety",
      {
        headers: threadId
          ? { "X-Thread-Id": threadId, "X-Session-Id": threadId }
          : undefined,
      },
    ),
  );
}

export async function saveTransactionSafety(
  request: ShellRequest,
  mode: TransactionSafetyMode,
  revision: number,
  threadId?: string,
): Promise<TransactionSafetyPolicy> {
  const policy = transactionSafetyPolicy(
    await request<TransactionSafetyPolicy>(
      threadId
        ? "/api/thread/transaction-safety"
        : "/api/account/transaction-safety",
      {
        method: "PUT",
        headers: threadId
          ? { "X-Thread-Id": threadId, "X-Session-Id": threadId }
          : undefined,
        body: JSON.stringify({ mode, expectedRevision: revision }),
      },
    ),
  );
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

export type TransactionSafetySave =
  | { ok: true; policy: TransactionSafetyPolicy }
  | { ok: false; error: unknown; latest?: TransactionSafetyPolicy };

/**
 * Save `mode` against `revision`. After a failure (usually a revision
 * conflict) read the latest policy instead; a write is never silently retried.
 */
export async function saveOrReloadTransactionSafety(
  request: ShellRequest,
  mode: TransactionSafetyMode,
  revision: number,
  threadId?: string,
): Promise<TransactionSafetySave> {
  try {
    return {
      ok: true,
      policy: await saveTransactionSafety(request, mode, revision, threadId),
    };
  } catch (error) {
    // Keep the original error if the re-read fails; admission stays
    // server-owned.
    const latest = await fetchTransactionSafety(request, threadId).catch(
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
