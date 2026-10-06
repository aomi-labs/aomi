import { portalService } from "./topology";
import type { DelegatedBearerContext } from "./service-topology";

/**
 * Mints the **AccountBearer** the Rust backend verifies — the only carrier of
 * account identity into the backend. Convention must match the `aomi-service`
 * verifier (docs/topics/account-authentication/facts/service-identity.md):
 * EdDSA, header `kid`, claims `sub`/`iss`/`aud`/`role`/`iat`/`exp`.
 *
 * `sub` is the Aomi account id (a `users.id` UUID), never a provider DID.
 * The portal's `AomiService` ([./topology](./topology.ts)) signs with the
 * private key and takes `iss`/`kid`/roles/audience from the committed
 * `service.portal.toml`. Node runtime only.
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
 * Sign an AccountBearer for an Aomi account. `role` defaults to
 * `user`; the topology authorizes it against `aomi-bff`'s configured roles.
 */
export async function mintAccountBearer(
  accountId: string,
  role: string = "user",
): Promise<MintedBearer> {
  const { accessToken, expiresAt } = await portalService().mint({
    role,
    subject: accountId,
    audience: AUDIENCE,
    ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
  });
  return { bearer: accessToken, expiresAt };
}

/** Sign the user assertion accepted only by the public Rust Agent API. */
export async function mintAgentApiBearer(
  accountId: string,
  delegated?: DelegatedBearerContext,
): Promise<MintedBearer> {
  const { accessToken, expiresAt } = await portalService().mint({
    role: "user",
    subject: accountId,
    audience: AGENT_API_AUDIENCE,
    ttlSeconds: ACCOUNT_BEARER_TTL_SECONDS,
    delegated,
  });
  return { bearer: accessToken, expiresAt };
}
