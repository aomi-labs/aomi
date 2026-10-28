/**
 * RC-only test identity. RC has no Portal, so nothing can sign a user in. This
 * lets one operator workflow exchange a GitHub Actions OIDC token for a short
 * `aomi-edge` user bearer on exactly one canonical RC account.
 *
 * The OIDC token is the identity proof: it must come from this repository's
 * main branch, `rc` environment and a named workflow, and each `jti` is
 * accepted once. The account id is configuration naming a real account row,
 * never taken from the request. Off unless the deployment is the rc topology
 * and every RC_OIDC_* var is set.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { EdgeEnv } from "../env";
import { edgeService, edgeTopologyName } from "../identity";
import { list } from "../kernel/config";
import { EdgeError, minted } from "../kernel/errors";
import { claimJti } from "./rc-replay";

export const RC_TOKEN_PATH = "/v1/rc/token";
export const RC_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const RC_OIDC_AUDIENCE = "aomi-rc-edge";
const REPOSITORY = "aomi-labs/product-mono";
const REPOSITORY_ID = "1033482171";
const REF = "refs/heads/main";
const ENVIRONMENT = "rc";
const MAX_TOKEN_AGE = "15m";
export const RC_BEARER_TTL_SECONDS = 15 * 60;
/** What each exchange can mint: the Agent REST bearer (default) or the account Payment one. */
const SERVICES = {
  agent: { audience: "aomi-api-server", resource: "/v1/agent", scope: "agent:read agent:write" },
  payment: { audience: "aomi-payment", resource: "/v1/account", scope: "account:credits:read account:credits:fund" },
} as const;

export type RcOidcConfig = { accountId: string; subject: string; workflows: readonly string[] };

/** The configuration when this request's deployment serves the RC identity path, else null. */
export function rcOidcConfig(env: EdgeEnv, host: string): RcOidcConfig | null {
  if (edgeTopologyName(env, host) !== "rc") return null;
  const accountId = env.RC_OIDC_ACCOUNT_ID?.trim();
  const subject = env.RC_OIDC_SUBJECT?.trim();
  const workflows = list(env.RC_OIDC_WORKFLOWS);
  if (!accountId || !subject || workflows.length === 0) return null;
  return { accountId, subject, workflows };
}

/** Agent REST resource of this host, as the API Server's `PublicResource::AgentRest` names it. */
export const agentResource = (origin: string) => `${origin}/v1/agent`;

let jwks: JWTVerifyGetKey | undefined;
const githubJwks = () => (jwks ??= createRemoteJWKSet(new URL(`${RC_OIDC_ISSUER}/.well-known/jwks`)));

export type VerifyKey = JWTVerifyGetKey;

function bearer(request: Request): string {
  const [scheme, token, extra] = (request.headers.get("authorization") ?? "").trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) throw new EdgeError(401, "invalid_token");
  return token;
}

/** Verify the OIDC token and its bindings; returns the claims' `jti` and `exp`. */
async function verified(token: string, cfg: RcOidcConfig, key: VerifyKey, now: number) {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: RC_OIDC_ISSUER,
      audience: RC_OIDC_AUDIENCE,
      algorithms: ["RS256"],
      maxTokenAge: MAX_TOKEN_AGE,
      currentDate: new Date(now),
      clockTolerance: 30,
      requiredClaims: ["exp", "iat", "jti", "sub"],
    }));
  } catch (cause) {
    // jose errors carry ERR_JOSE_* / ERR_JW* codes; anything else is a JWKS fetch fault.
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && /^ERR_(JOSE|JW[SEKT])/.test(code)) throw new EdgeError(401, "invalid_token", { cause });
    throw new EdgeError(502, "oidc_unavailable", { cause });
  }
  const bound =
    payload.sub === cfg.subject &&
    payload.repository === REPOSITORY &&
    payload.repository_id === REPOSITORY_ID &&
    payload.ref === REF &&
    payload.environment === ENVIRONMENT &&
    typeof payload.job_workflow_ref === "string" &&
    cfg.workflows.includes(payload.job_workflow_ref);
  if (!bound) throw new EdgeError(403, "forbidden_identity");
  return { jti: payload.jti as string, exp: payload.exp as number };
}

/** POST /v1/rc/token: exchange one OIDC token for a short RC user bearer. */
export async function exchangeRcToken(
  request: Request,
  env: EdgeEnv,
  cfg: RcOidcConfig,
  key: VerifyKey = githubJwks(),
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: { allow: "POST, OPTIONS" } });
  const replay = env.RC_OIDC_REPLAY;
  // Without a place to remember tokens, a replay cannot be refused.
  if (!replay) throw new EdgeError(503, "replay_store_unavailable");
  // Refuse an unknown service before a valid token is spent on it.
  const url = new URL(request.url);
  const name = url.searchParams.get("service") ?? "agent";
  if (!Object.hasOwn(SERVICES, name)) throw new EdgeError(400, "unknown_service");
  const service = SERVICES[name as keyof typeof SERVICES];
  const { jti, exp } = await verified(bearer(request), cfg, key, now);

  // Held past `exp` so clock skew cannot reopen the window.
  const claimed = await claimJti(replay, jti, (exp + 60) * 1000).catch((cause) => {
    throw new EdgeError(503, "replay_store_unavailable", { cause });
  });
  if (!claimed) throw new EdgeError(401, "replayed_token");

  const origin = url.origin;
  const { accessToken } = await minted(() =>
    edgeService(env, new URL(request.url).host).mint({
      role: "user",
      subject: cfg.accountId,
      audience: service.audience,
      ttlSeconds: RC_BEARER_TTL_SECONDS,
      delegated: {
        scope: service.scope,
        resource: `${origin}${service.resource}`,
        auth_source: "session",
        principal_class: "user",
        sid: "session-bound",
      },
    }),
  );
  return Response.json(
    { access_token: accessToken, token_type: "Bearer", expires_in: RC_BEARER_TTL_SECONDS, scope: service.scope },
    { headers: { "cache-control": "no-store" } },
  );
}
