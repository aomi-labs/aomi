import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  EmbeddedJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from "jose";

export const DPOP_SIGNING_ALGORITHMS = ["ES256", "EdDSA"] as const;
/** RFC 9449 §4.3: a proof older than this is refused. */
export const DPOP_PROOF_MAX_AGE_SECONDS = 300;

export class DpopError extends Error {
  constructor(readonly description: string) {
    super("invalid_dpop_proof");
    this.name = "DpopError";
  }
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64url(value: string): Promise<string> {
  return base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/** The request URL as DPoP binds it: no query, no fragment. */
export function dpopHtu(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/**
 * Verify a DPoP proof (RFC 9449) for an access token bound to it: the proof is
 * a fresh JWT signed by the key in its header, names this method and URL,
 * hashes the token (`ath`) and that key's thumbprint equals the token's
 * `cnf.jkt`. Replay within the proof window is not tracked at the edge.
 */
export async function verifyDpopProof(input: {
  proof: string;
  method: string;
  url: string;
  accessToken: string;
  accessTokenClaims: JWTPayload;
  now?: () => number;
}): Promise<void> {
  const nowSeconds = Math.floor((input.now ?? Date.now)() / 1000);
  let header;
  try {
    header = decodeProtectedHeader(input.proof);
  } catch {
    throw new DpopError("DPoP proof is not a JWT");
  }
  if (header.typ !== "dpop+jwt") throw new DpopError("DPoP proof typ must be dpop+jwt");
  if (!header.alg || !DPOP_SIGNING_ALGORITHMS.includes(header.alg as never))
    throw new DpopError("DPoP proof uses an unsupported algorithm");
  if (!header.jwk || typeof header.jwk !== "object")
    throw new DpopError("DPoP proof carries no public key");
  const jwk = header.jwk as JWK;
  if ((jwk as { d?: unknown }).d !== undefined)
    throw new DpopError("DPoP proof key must be public");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(input.proof, EmbeddedJWK, {
      algorithms: [...DPOP_SIGNING_ALGORITHMS],
      typ: "dpop+jwt",
      clockTolerance: 0,
    }));
  } catch {
    throw new DpopError("DPoP proof signature is invalid");
  }
  if (typeof payload.jti !== "string" || !payload.jti)
    throw new DpopError("DPoP proof needs a jti");
  if (typeof payload.iat !== "number")
    throw new DpopError("DPoP proof needs an iat");
  if (Math.abs(nowSeconds - payload.iat) > DPOP_PROOF_MAX_AGE_SECONDS)
    throw new DpopError("DPoP proof is too old");
  if (payload.htm !== input.method)
    throw new DpopError("DPoP proof htm does not match the request");
  if (payload.htu !== dpopHtu(input.url))
    throw new DpopError("DPoP proof htu does not match the request");
  if (payload.ath !== (await sha256Base64url(input.accessToken)))
    throw new DpopError("DPoP proof ath does not match the access token");
  const cnf = input.accessTokenClaims.cnf as { jkt?: unknown } | undefined;
  if (typeof cnf?.jkt !== "string")
    throw new DpopError("access token is not DPoP-bound");
  if (cnf.jkt !== (await calculateJwkThumbprint(jwk)))
    throw new DpopError("DPoP proof key does not match the access token binding");
}
