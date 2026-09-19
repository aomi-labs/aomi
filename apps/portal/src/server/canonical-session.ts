import { resolvePortalCanonicalUserId } from "@portal/server/widget-auth/principal";
import { resolveE2ECanonicalUserId } from "@portal/server/e2e-wallet";

/**
 * Resolve the canonical backend user id for a cross-origin proxy request,
 * honouring the E2E canonical-user override before falling back to the portal
 * principal (BetterAuth session or widget session). The override is gated
 * behind the E2E wallet env + a signed cookie, so it is inert in normal
 * runtime.
 *
 * This lives in `src/server` (rather than inside `principal.ts`) so the
 * server-only E2E wallet module is never pulled into shared `src/lib` code.
 */
export async function resolveCanonicalUserId(
  request: Request,
): Promise<string | null> {
  const e2eUserId = resolveE2ECanonicalUserId(request);
  if (e2eUserId) return e2eUserId;
  return resolvePortalCanonicalUserId(request);
}
