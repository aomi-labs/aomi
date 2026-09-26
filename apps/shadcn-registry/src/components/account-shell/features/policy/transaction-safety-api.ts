import { transactionSafetyPolicy } from "@aomi-labs/client";
import type {
  TransactionSafetyMode,
  TransactionSafetyPolicy,
} from "@aomi-labs/client";
import type { ShellRequest } from "../../transport";

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
  return policy;
}
