import { AomiApiError, COMMIT_REF_ERROR_CODES } from "@aomi-labs/client";

/** Why Commit Service refused to sign with an agent wallet, and which one. */
export type WalletRefusal = {
  kind: "paused" | "archived" | "no_access";
  walletId?: string;
  walletName?: string;
  connectionKey?: string;
};

const KINDS: Record<string, WalletRefusal["kind"]> = {
  [COMMIT_REF_ERROR_CODES.walletPaused]: "paused",
  [COMMIT_REF_ERROR_CODES.walletArchived]: "archived",
  [COMMIT_REF_ERROR_CODES.walletNoAccess]: "no_access",
};

// A quoted wallet name may hold `]`; the tag ends at the first bare one.
const MARKER = /\[err\.type=(commit_wallet_[a-z_]+)((?:"[^"]*"|[^\]"])*)\]/;
const FIELD = /(agent_wallet_id|wallet_name|connection_key)=("[^"]*"|\S+)/g;

const text = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;

/**
 * A refusal from an approve call (the error's code, with `{agent_wallet_id,
 * wallet_name, connection_key}` in its details) or from a tool's error text
 * (`[err.type=commit_wallet_paused agent_wallet_id=… wallet_name="…"
 * connection_key=…]`). Anything else is not a wallet refusal.
 */
export function walletRefusalOf(cause: unknown): WalletRefusal | null {
  if (cause instanceof AomiApiError) {
    const kind = KINDS[cause.code];
    if (!kind) return null;
    const details = (cause.details ?? {}) as Record<string, unknown>;
    return {
      kind,
      walletId: text(details.agent_wallet_id),
      walletName: text(details.wallet_name),
      connectionKey: text(details.connection_key),
    };
  }
  if (typeof cause !== "string") return null;
  // A tool result may arrive JSON-encoded, with its quotes escaped.
  const marker = MARKER.exec(cause.replace(/\\"/g, '"'));
  const kind = marker ? KINDS[marker[1]!] : undefined;
  if (!marker || !kind) return null;
  const fields = Object.fromEntries(
    [...marker[2]!.matchAll(FIELD)].map(([, key, value]) => [
      key,
      value!.replace(/^"|"$/g, ""),
    ]),
  );
  return {
    kind,
    walletId: text(fields.agent_wallet_id),
    walletName: text(fields.wallet_name),
    connectionKey: text(fields.connection_key),
  };
}
