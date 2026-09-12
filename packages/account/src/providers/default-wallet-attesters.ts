import { readAccountAuthEnv, type AccountAuthEnv } from "../better-auth/env";
import {
  listParaWalletsForUser,
  paraUserIdentifierType,
  type ParaUserIdentifierType,
} from "./para";
import { listPrivyWalletsForUser } from "./privy";
import type {
  ProviderLoginIdentifier,
  WalletAttesterRegistry,
} from "./wallet-attestation";

export function createDefaultWalletAttesters(
  env: AccountAuthEnv = readAccountAuthEnv(),
): WalletAttesterRegistry {
  const attesters: WalletAttesterRegistry = {};

  const privyAppId = env.privyAppId;
  const privyAppSecret = env.privyAppSecret;
  if (privyAppId && privyAppSecret) {
    attesters.privy = ({ subject }) =>
      listPrivyWalletsForUser({
        appId: privyAppId,
        appSecret: privyAppSecret,
        userId: subject,
      });
  }

  const paraApiKey = env.paraApiKey;
  if (paraApiKey) {
    attesters.para = async ({ subject, email, loginIdentifier }) => {
      const lookup = paraWalletLookup({ subject, email, loginIdentifier });
      // No lookup key means Para cannot be asked about this user at all (an
      // `externalWallet` login, say). Answering `null` keeps that apart from
      // "Para says this user has no embedded wallet" so a caller that requires
      // a hosted wallet fails closed instead of inferring an empty set.
      if (!lookup) return null;
      return listParaWalletsForUser({ apiKey: paraApiKey, ...lookup });
    };
  }

  return attesters;
}

/**
 * Pick the `userIdentifier` / `userIdentifierType` pair Para's wallet API is
 * keyed by. That API is partner-scoped and indexed by the user's login handle;
 * its `userIdentifierType` enum has no member naming a Para user id, so the
 * session token's `sub` cannot be used as a lookup key. The verified login
 * identifier is the right key, a verified email is the fallback for a token
 * that omits it, and `CUSTOM_ID` on the subject stays last for partners that
 * pregenerate wallets under their own ids.
 */
function paraWalletLookup(input: {
  subject: string;
  email?: string | null;
  loginIdentifier?: ProviderLoginIdentifier | null;
}): {
  userIdentifier: string;
  userIdentifierType: ParaUserIdentifierType;
} | null {
  const identifierType = paraUserIdentifierType(input.loginIdentifier?.type);
  if (identifierType && input.loginIdentifier?.value) {
    return {
      userIdentifier: input.loginIdentifier.value,
      userIdentifierType: identifierType,
    };
  }
  if (input.loginIdentifier) return null;
  if (input.email) {
    return { userIdentifier: input.email, userIdentifierType: "EMAIL" };
  }
  return { userIdentifier: input.subject, userIdentifierType: "CUSTOM_ID" };
}
