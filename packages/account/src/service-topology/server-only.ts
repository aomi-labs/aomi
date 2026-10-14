/**
 * Throws if the engine is ever imported into a browser bundle — it signs with
 * EdDSA private keys and must run only on a server. `AomiService.fromTopology`
 * calls this, so a stray client import fails loudly instead of leaking a key.
 */
export function assertServerOnly(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.__AOMI_ALLOW_BROWSER__ === true) return;
  if (
    typeof (g as { window?: unknown }).window !== "undefined" &&
    typeof (g as { document?: unknown }).document !== "undefined"
  ) {
    throw new Error(
      "@aomi-labs/service is server-only: it signs with EdDSA private keys and " +
        "must never run in a browser. Import it from a server route handler.",
    );
  }
}
