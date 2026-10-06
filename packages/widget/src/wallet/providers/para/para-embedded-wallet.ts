"use client";

import { canonicalWalletKey } from "../../catalog/wallet-branding";
import { PARA_BRAND_KEY } from "./para-brand";
import type { AomiAccount } from "../../types";

export function isParaEmbeddedAccount(account: AomiAccount): boolean {
  return (
    canonicalWalletKey(
      `${account.id} ${account.walletName ?? ""} ${
        account.connectorIds?.join(" ") ?? ""
      }`,
    ) === PARA_BRAND_KEY
  );
}
