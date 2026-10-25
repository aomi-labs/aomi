import {
  aomiOAuthResourcePolicy,
  type AomiOAuthResourcePolicy,
} from "@aomi-labs/account/better-auth";
import {
  authorize as decide,
  capabilitiesOf,
  type Capability,
  type Need,
} from "@aomi-labs/account/policy";
import { PrincipalError, type Principal } from "./principal";

export type { Capability, Need };

export function capabilities(
  principal: Exclude<Principal, { kind: "none" | "oauth" }>,
): readonly Capability[] {
  return capabilitiesOf(principal.kind, principal.guest);
}

export function policyFor(resource: string): AomiOAuthResourcePolicy {
  const policy = aomiOAuthResourcePolicy(resource);
  if (!policy) throw new Error(`unknown protected resource ${resource}`);
  return policy;
}

/**
 * The one permission check, from `@aomi-labs/account/policy`. Returns the
 * scopes to mint for a protected resource (empty for capability routes), or
 * throws a PrincipalError.
 */
export function authorize(principal: Principal, need: Need): string[] {
  const result = decide(principal, need, policyFor);
  if ("scopes" in result) return result.scopes;
  const { status, code, requiredScopes } = result.denied;
  throw new PrincipalError(status, code, requiredScopes);
}
