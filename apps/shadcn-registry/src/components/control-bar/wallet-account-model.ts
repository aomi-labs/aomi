import { formatWalletProvider } from "../../lib/wallet-kit";
import type { WalletFamily } from "../../lib/wallet-kit/types";
import type { WalletRow } from "../../lib/wallet-kit/composer/wallet-state";

export type WalletModalRow = WalletRow;

export function familyLabel(family: WalletFamily): string {
  return family === "svm" ? "Solana" : "Ethereum";
}

export function sameWalletAddress(
  family: WalletFamily,
  left?: string,
  right?: string,
): boolean {
  if (!left || !right) return false;
  return family === "evm"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export function providerBackedAccountProvider(input: {
  provider?: string;
  kind?: string;
  linkedVia?: string;
  walletKind?: string;
  source?: string;
}): string | null {
  if (!input.provider) return null;
  if (input.linkedVia === "siwe" || input.linkedVia === "siws") return null;
  const walletKind = input.walletKind ?? input.kind;
  if (walletKind === "embedded" || walletKind === "smart_account") {
    return input.provider;
  }
  if (input.source === "live" && walletKind == null) return input.provider;
  return input.source === "embedded" ? input.provider : null;
}

export function providerBackedWalletTitle(input: {
  provider?: string;
  walletName?: string;
  family: WalletFamily;
  kind?: string;
  walletKind?: string;
  source?: string;
}): string {
  const provider = providerBackedAccountProvider(input);
  return provider !== null
    ? (formatWalletProvider(provider) ?? provider)
    : (input.walletName ?? familyLabel(input.family));
}
