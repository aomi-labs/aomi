import type * as PrivyAuth from "@privy-io/react-auth";
import type * as PrivySmartWallets from "@privy-io/react-auth/smart-wallets";
import type * as PrivySolana from "@privy-io/react-auth/solana";

/**
 * Privy's SDK modules, handed in by whoever loaded them. The island code only
 * imports Privy types, so bundlers never need Privy for hosts that do not use
 * it; the lazy loader or the eager provider entry supplies the modules.
 */
export type PrivySdk = {
  auth: typeof PrivyAuth;
  smartWallets: typeof PrivySmartWallets;
  solana: typeof PrivySolana;
};

let sdk: PrivySdk | undefined;

export function setPrivySdk(next: PrivySdk): void {
  sdk = next;
}

export function privySdk(): PrivySdk {
  if (!sdk) throw new Error("[aomi] Privy rendered before its SDK loaded.");
  return sdk;
}
