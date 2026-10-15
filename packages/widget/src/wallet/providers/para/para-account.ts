"use client";

import { canonicalWalletKey } from "@/wallet/catalog/wallet-branding";
import {
  PARA_BRAND_KEY,
  PARA_SESSION_UID,
} from "@/wallet/providers/para/para-brand";
import { type AomiAccount } from "@/wallet/types";

export function isParaEmbeddedAccount(account: AomiAccount): boolean {
  return (
    canonicalWalletKey(
      `${account.id} ${account.walletName ?? ""} ${
        account.connectorIds?.join(" ") ?? ""
      }`,
    ) === PARA_BRAND_KEY
  );
}

/** Para auth publishes a synthetic row before wagmi has a real signer. */
export function shouldConnectParaEvmSession(
  authenticated: boolean,
  connections: ReadonlyArray<{ uid: string; stableId: string }>,
): boolean {
  return (
    authenticated &&
    !connections.some(
      (connection) =>
        connection.stableId === PARA_BRAND_KEY &&
        connection.uid !== PARA_SESSION_UID,
    )
  );
}
