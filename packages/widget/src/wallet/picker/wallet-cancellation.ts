const EXPECTED_WALLET_CANCELLATION_PATTERNS = [
  "user rejected",
  "user denied",
  "user cancelled",
  "user canceled",
  "request cancelled by user",
  "request canceled by user",
  "connection request reset",
  "connection request rejected",
  "connection proposal expired",
  "walletconnect modal closed",
  "wallet connect modal closed",
] as const;

/** Wallet dismissal is a normal exit path, not an error the user must fix. */
export function isExpectedWalletCancellation(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === "string") {
      const message = current.toLowerCase();
      if (
        EXPECTED_WALLET_CANCELLATION_PATTERNS.some((pattern) =>
          message.includes(pattern),
        )
      ) {
        return true;
      }
      continue;
    }
    if (typeof current !== "object") continue;

    const value = current as Record<string, unknown>;
    if (
      value.code === 4001 ||
      value.code === "4001" ||
      value.code === "ACTION_REJECTED" ||
      value.code === "USER_REJECTED"
    ) {
      return true;
    }

    for (const field of ["name", "message", "shortMessage", "details"]) {
      if (field in value) pending.push(value[field]);
    }
    if ("cause" in value) pending.push(value.cause);
  }

  return false;
}
