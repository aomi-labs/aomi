import {
  aomiOAuthResourcePolicy,
  type AomiOAuthResourcePolicy,
} from "@aomi-labs/account/better-auth";
import {
  authorize as decide,
  capabilitiesOf,
  type Capability,
  type Need as PolicyNeed,
} from "@aomi-labs/account/policy";
import { PrincipalError, type Principal } from "./principal";

export type { Capability };

/** Portal retains session capabilities; OAuth resources are served by Edge. */
export type Need = Extract<PolicyNeed, { capability: Capability }>;

export function capabilities(
  principal: Exclude<Principal, { kind: "none" }>,
): readonly Capability[] {
  return capabilitiesOf(principal.kind, principal.guest);
}

function policyFor(resource: string): AomiOAuthResourcePolicy {
  const policy = aomiOAuthResourcePolicy(resource);
  if (!policy) throw new Error(`unknown protected resource ${resource}`);
  return policy;
}

/** Enforce the shared account policy for Portal's session-only routes. */
export function authorize(principal: Principal, need: Need): void {
  const result = decide(principal, need, policyFor);
  if ("scopes" in result) return;
  const { status, code } = result.denied;
  throw new PrincipalError(status, code);
}
