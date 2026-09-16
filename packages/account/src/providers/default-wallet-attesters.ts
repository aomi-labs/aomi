import { readAccountAuthEnv, type AccountAuthEnv } from "../better-auth/env";
import { listParaWalletsForUser } from "./para";
import { listPrivyWalletsForUser } from "./privy";
import type { WalletAttesterRegistry } from "./wallet-attestation";

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
    attesters.para = ({ subject }) =>
      listParaWalletsForUser({
        apiKey: paraApiKey,
        userIdentifier: subject,
        userIdentifierType: "CUSTOM_ID",
      });
  }

  return attesters;
}
