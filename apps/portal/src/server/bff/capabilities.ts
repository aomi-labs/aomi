import { aomiOAuthResourcePolicy, type AomiOAuthResourcePolicy } from "@aomi-labs/account/better-auth/core";

import { PrincipalError, type Principal } from "./principal";

/** What a caller may do. Granted by the credential, never by the endpoint. */
export type Capability =
  | "chat" // threads, turns, catalogs, simulations
  | "actions" // resolve staged actions and commits
  | "account" // own profile, identities, wallets, provider links, deactivation
  | "account_read" // credits and usage statement
  | "payments" // top-ups and payment signatures
  | "custody" // delegated custody
  | "settings" // installed apps, app secrets, BYOK keys
  | "safety_policy" // account and thread transaction safety
  | "managed_signing" // execution profile, AA accounts, signing requests
  | "backend_bearer" // a raw 15-minute backend token
  | "cli_session" // a separate one-day CLI session
  | "device_login" // grant a CLI device login
  | "mcp"; // MCP transport, OAuth grants only

const SIGNED_IN: readonly Capability[] = [
  "chat",
  "actions",
  "account",
  "account_read",
  "payments",
  "custody",
  "settings",
  "safety_policy",
  "managed_signing",
  "backend_bearer",
  "cli_session",
  "device_login",
];
const GUEST: readonly Capability[] = [
  "chat",
  "actions",
  "account",
  "backend_bearer",
  "device_login",
];
// Any https site may embed the widget, so its sessions never get a raw backend
// token or mint CLI logins.
const EMBEDDED: readonly Capability[] = [
  "backend_bearer",
  "cli_session",
  "device_login",
];

type SessionKind = Exclude<Principal["kind"], "none" | "oauth">;

/** Today's grants per credential. OAuth grants are the token's own scopes. */
const GRANTS: Record<
  SessionKind,
  { user: readonly Capability[]; guest: readonly Capability[] }
> = {
  // Rotating a CLI session revokes the presented one, so a browser cookie may
  // not ask for it.
  cookie: {
    user: SIGNED_IN.filter((capability) => capability !== "cli_session"),
    guest: GUEST,
  },
  session_bearer: { user: SIGNED_IN, guest: GUEST },
  widget: {
    user: SIGNED_IN.filter((capability) => !EMBEDDED.includes(capability)),
    guest: GUEST.filter((capability) => !EMBEDDED.includes(capability)),
  },
  // The local E2E stand-in only ever served the proxied APIs.
  e2e: {
    user: SIGNED_IN.filter(
      (capability) =>
        !["account", "cli_session", "device_login"].includes(capability),
    ),
    guest: [],
  },
};

const SCOPE_CAPABILITY: Record<string, Capability> = {
  "agent:read": "chat",
  "agent:write": "chat",
  "pipeline:catalog": "chat",
  "pipeline:execute": "chat",
  "agent:actions:resolve": "actions",
  "payments:submit": "payments",
  "account:credits:topup": "payments",
  "custody:delegate": "custody",
  "account:credits:read": "account_read",
  "account:usage:read": "account_read",
  "account:transaction-safety:read": "safety_policy",
  "account:transaction-safety:write": "safety_policy",
  "account:apps:read": "settings",
  "account:apps:write": "settings",
  "account:credentials:read": "settings",
  "account:credentials:write": "settings",
  "mcp:agent": "mcp",
  "mcp:pipeline": "mcp",
};

export function capabilities(
  principal: Exclude<Principal, { kind: "none" | "oauth" }>,
): readonly Capability[] {
  const grants = GRANTS[principal.kind];
  return principal.guest ? grants.guest : grants.user;
}

export function capabilityOfScope(scope: string): Capability | undefined {
  return SCOPE_CAPABILITY[scope];
}

/** The scopes a principal holds on a protected resource. */
export function scopesOn(
  principal: Exclude<Principal, { kind: "none" }>,
  policy: AomiOAuthResourcePolicy,
): readonly string[] {
  if (principal.kind === "oauth") return principal.scopes;
  const granted = capabilities(principal);
  return policy.allowedScopes.filter((scope) => {
    const capability = capabilityOfScope(scope);
    return capability !== undefined && granted.includes(capability);
  });
}

export function policyFor(resource: string): AomiOAuthResourcePolicy {
  const policy = aomiOAuthResourcePolicy(resource);
  if (!policy) throw new Error(`unknown protected resource ${resource}`);
  return policy;
}

/** What a route needs: a capability, or scopes on a protected resource. */
export type Need =
  | { capability: Capability; anonymous?: true }
  | { resource: string; scopes: readonly string[] };

const DELEGATING_SCOPES = ["agent:write", "pipeline:execute"];

/**
 * The one permission check. Returns the scopes to mint for a protected
 * resource (empty for capability routes), or throws a PrincipalError.
 */
export function authorize(principal: Principal, need: Need): string[] {
  if (principal.kind === "none") {
    if ("capability" in need && need.anonymous) return [];
    throw new PrincipalError(401, "unauthenticated");
  }
  if ("capability" in need) {
    if (principal.kind === "oauth")
      throw new PrincipalError(401, "invalid_token");
    if (!capabilities(principal).includes(need.capability))
      throw new PrincipalError(403, "insufficient_scope");
    return [];
  }
  const held = scopesOn(principal, policyFor(need.resource));
  if (need.scopes.some((scope) => !held.includes(scope)))
    throw new PrincipalError(403, "insufficient_scope", need.scopes);
  const minted = [...new Set(need.scopes)];
  if (
    need.scopes.some((scope) => DELEGATING_SCOPES.includes(scope)) &&
    held.includes("custody:delegate")
  )
    minted.push("custody:delegate");
  return minted;
}
