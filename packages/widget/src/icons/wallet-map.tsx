import type { FC, SVGProps } from "react";
import {
  canonicalWalletKey,
  normalizeWalletOptionId,
} from "../../lib/wallet-kit/catalog/wallet-branding";
import {
  BaseWalletIcon,
  CoinbaseWalletIcon,
  MetaMaskIcon,
  ParaWalletIcon,
  PhantomIcon,
  PrivyWalletIcon,
  RabbyIcon,
  RainbowIcon,
  WalletConnectIcon,
} from "./wallets";

// Keyed by `canonicalWalletKey` output so brand matching lives in one place.
const WALLET_ICONS: Record<string, FC<SVGProps<SVGSVGElement>>> = {
  base: BaseWalletIcon,
  basewallet: BaseWalletIcon,
  coinbase: CoinbaseWalletIcon,
  metamask: MetaMaskIcon,
  para: ParaWalletIcon,
  phantom: PhantomIcon,
  privy: PrivyWalletIcon,
  rabby: RabbyIcon,
  rainbow: RainbowIcon,
  walletconnect: WalletConnectIcon,
};

/**
 * Get the icon component for a wallet label or connector id.
 * Returns undefined for unknown wallets.
 */
export function getWalletIcon(
  walletIdOrLabel: string,
): FC<SVGProps<SVGSVGElement>> | undefined {
  const direct = WALLET_ICONS[normalizeWalletOptionId(walletIdOrLabel)];
  return direct ?? WALLET_ICONS[canonicalWalletKey(walletIdOrLabel)];
}

export function getWalletIconBrand(
  walletIdOrLabel: string,
): string | undefined {
  const direct = normalizeWalletOptionId(walletIdOrLabel);
  if (WALLET_ICONS[direct]) return direct;
  const brand = canonicalWalletKey(walletIdOrLabel);
  return WALLET_ICONS[brand] ? brand : undefined;
}
