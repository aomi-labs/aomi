"use client";

/**
 * Turn a failed account call into something a person can act on. Account
 * routes answer with `{"error": "<code>"}`, which is never shown verbatim.
 */
export function explainAccountError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  let code = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      code = String((parsed as { error: unknown }).error);
    }
  } catch {
    // Not JSON — fall through and match the bare text.
  }

  if (/authentication required/i.test(code)) {
    return "Sign in to see your account.";
  }
  switch (code) {
    case "internal":
      return "The server hit an error. Try again shortly.";
    case "widget_auth_failed":
      return "Couldn’t authenticate your account. Sign in again and retry.";
    default:
      // Transport failures commonly arrive as structured JSON. Never render
      // an unknown server payload verbatim in Settings; it is implementation
      // detail, not an actionable message for the account holder.
      if (code !== raw) {
        return "Couldn’t load your account. Try again shortly.";
      }
      return raw || "Something went wrong.";
  }
}
