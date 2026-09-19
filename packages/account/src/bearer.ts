import { portalService } from "./topology";
import type { DelegatedBearerContext } from "@aomi-labs/service";

/**
 * Mints the **AccountBearer** the Rust backend verifies — the only carrier of
 * account identity into the backend. Convention must match the `aomi-service`
 * verifier (docs/topics/account-authentication/facts/service-identity.md):
 * EdDSA, header `kid`, claims `sub`/`iss`/`aud`/`role`/`iat`/`exp`.
 *
 * `sub` is our **canonical user id** (a `users.id` UUID), never a provider DID.
 * Signing now goes through the portal's `AomiService` ([./topology](./topology.ts)):
 * it holds the private key (env) and takes `iss`/`kid`/allowed-roles/audience
 * from the committed `service.portal.toml`. Node runtime only.
 */
export const AUDIENCE = "aomi-backend";
export const AGENT_API_AUDIENCE = "aomi-api-server";
export const ACCOUNT_BEARER_TTL_SECONDS = 15 * 60;

export type MintedBearer = {
  /** The signed EdDSA JWT — used as the `Authorization: Bearer` AccountBearer. */
  bearer: string;
  /** Expiry, unix seconds — matches the `exp` claim. */
  expiresAt: number;
};

/**
 * Sign an AccountBearer for a resolved canonical user. `role` defaults to
 * `user`; the topology authorizes it against `aomi-bff`'s configured roles.
 *
 * `@aomi-labs/service` is the generic JWT signer (service-mesh tokens too), so it
 * returns the neutral `accessToken`; we re-label it `bearer` here — the account
 * domain names this credential a bearer, never a token.
 */
export async function mintAccountBearer(
  canonicalUserId: string,
  role: string = "user",
): Promise<MintedBearer> {
  const { accessToken, expiresAt } = await portalService().mint({
    role,
    subject: canonicalUserId,
    audience: AUDIENCE,
    ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
  });
  return { bearer: accessToken, expiresAt };
}

/** Sign the user assertion accepted only by the public Rust Agent API. */
export async function mintAgentApiBearer(
  canonicalUserId: string,
  delegated?: DelegatedBearerContext,
): Promise<MintedBearer> {
  const { accessToken, expiresAt } = await portalService().mint({
    role: "user",
    subject: canonicalUserId,
    audience: AGENT_API_AUDIENCE,
    ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
    delegated,
  });
  return { bearer: accessToken, expiresAt };
}
