import type { LinkedAuthAccount } from "../../../../../lib/wallet-kit/account/types";
import type { StatusTone } from "../../../../ui/aomi/status-pill";
import type { ManagedWallet } from "../wallet-management-model";

export type LoginProvider = "para" | "privy";

export type WalletGroup =
  | {
      kind: "provider";
      key: string;
      provider: LoginProvider;
      identity?: LinkedAuthAccount;
      wallets: ManagedWallet[];
    }
  | { kind: "external"; key: string; wallet: ManagedWallet };

export function loginProvider(value?: string): LoginProvider | undefined {
  const provider = value?.toLowerCase();
  return provider === "para" || provider === "privy" ? provider : undefined;
}

export const providerName = (provider: LoginProvider) =>
  provider === "para" ? "Para" : "Privy";

export const familyName = (wallet: ManagedWallet) =>
  wallet.family === "evm" ? "EVM" : "SVM";

/**
 * One card per Para/Privy login with its addresses nested under it, then one
 * card per external wallet. The account graph does not say which login owns
 * an embedded address, so a provider's addresses sit under its first login
 * and any further login of that provider shows without addresses.
 */
export function groupWallets(
  wallets: readonly ManagedWallet[],
  signInMethods: readonly LinkedAuthAccount[],
): WalletGroup[] {
  const byProvider = new Map<LoginProvider, ManagedWallet[]>();
  const external: WalletGroup[] = [];
  for (const wallet of wallets) {
    const provider = loginProvider(wallet.provider);
    if (!provider) {
      external.push({ kind: "external", key: wallet.key, wallet });
      continue;
    }
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), wallet]);
  }
  const familyFirst = (list: ManagedWallet[] = []) =>
    [...list].sort(
      (a, b) => Number(a.family === "svm") - Number(b.family === "svm"),
    );

  const providers: WalletGroup[] = [];
  for (const identity of signInMethods) {
    const provider = loginProvider(identity.provider);
    if (!provider) continue;
    providers.push({
      kind: "provider",
      key: `identity:${identity.id}`,
      provider,
      identity,
      wallets: familyFirst(byProvider.get(provider)),
    });
    byProvider.delete(provider);
  }
  for (const [provider, list] of byProvider) {
    providers.push({
      kind: "provider",
      key: `provider:${provider}`,
      provider,
      wallets: familyFirst(list),
    });
  }
  return [...providers, ...external];
}

export type AddressLineStatus = {
  label: string;
  tone: StatusTone;
  /** The one fix offered inline; both map to existing row handlers. */
  action?: { kind: "link" | "connect"; label: string };
};

/**
 * The single status an address line shows, or null when it needs nothing.
 * Active wins the pill but keeps the state's inline fix.
 */
export function addressLineStatus(
  wallet: ManagedWallet,
): AddressLineStatus | null {
  const has = (kind: ManagedWallet["actions"][number]["kind"]) =>
    wallet.actions.some((action) => action.kind === kind);
  const status = stateStatus(wallet, has);
  if (!wallet.operating) return status;
  return {
    label: "Active",
    tone: "success",
    ...(status?.action ? { action: status.action } : {}),
  };
}

function stateStatus(
  wallet: ManagedWallet,
  has: (kind: ManagedWallet["actions"][number]["kind"]) => boolean,
): AddressLineStatus | null {
  switch (wallet.state) {
    case "ready":
      return null;
    case "guest":
    case "unlinked":
      return {
        label: "Not linked",
        tone: "warning",
        ...(has("link")
          ? { action: { kind: "link", label: "Link wallet" } as const }
          : {}),
      };
    case "loading":
      return { label: "Checking…", tone: "neutral" };
    case "mismatch":
      return {
        label: "Address changed",
        tone: "danger",
        ...(has("reauthenticate")
          ? { action: { kind: "connect", label: "Re-verify" } as const }
          : {}),
      };
    case "offline":
      switch (wallet.reason) {
        case "disconnected":
          return {
            label: "Not on this device",
            tone: "neutral",
            ...(has("connect")
              ? { action: { kind: "connect", label: "Connect" } as const }
              : {}),
          };
        case "signer_unavailable":
          return {
            label: "Session expired",
            tone: "warning",
            ...(has("reauthenticate")
              ? { action: { kind: "connect", label: "Sign in again" } as const }
              : {}),
          };
        case "provider_unavailable": {
          const provider = loginProvider(wallet.provider);
          return {
            label: `${provider ? providerName(provider) : "Provider"} not loaded`,
            tone: "neutral",
          };
        }
        case "selection_required":
          return null;
        case "account_error":
          return { label: "Couldn't verify", tone: "neutral" };
      }
  }
}
