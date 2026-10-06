import type { AomiWalletKit, WalletFamily } from "@/wallet/types";
import {
  canonicalWalletKey,
  normalizeWalletOptionId,
} from "@/wallet/catalog/wallet-branding";

export type WalletAction = {
  preload?: () => void;
  id: string;
  provider?: string;
  label: string;
  family: WalletFamily;
  kind: "evm" | "solana" | "walletconnect" | "social";
  source: "option";
  status: "installed" | "available" | "qr" | "unavailable";
  actions: Array<{ kind: "connect" | "authenticate"; label: string }>;
  iconUrl?: string;
  actionKey: string;
  connect: () => Promise<void>;
  ready?: boolean;
  description?: string;
};

export const GENERIC_BROWSER_WALLET_ID = "generic-browser-wallet";

export function walletStatusLabel(option: WalletAction): string {
  if (option.status === "unavailable") return "Not installed";
  return "Ready";
}

function statusRank(option: WalletAction): number {
  if (option.status === "available") return 1;
  return 3;
}

function walletDisplayRank(option: WalletAction): number {
  const id = option.id.toLowerCase();
  const label = option.label.toLowerCase();
  if (id === GENERIC_BROWSER_WALLET_ID) return 30;
  if (id.includes("metamask") || label.includes("metamask")) return 0;
  if (id.includes("rabby") || label.includes("rabby")) return 1;
  if (id.includes("phantom") || label.includes("phantom")) return 2;
  if (id.includes("solflare") || label.includes("solflare")) return 3;
  if (id.includes("backpack") || label.includes("backpack")) return 4;
  if (id.includes("coinbase") || label.includes("coinbase")) return 5;
  if (id.includes("walletconnect") || label.includes("walletconnect")) return 6;
  return 20;
}

function walletAliasKey(wallet: Pick<WalletAction, "id" | "label">): string {
  const combined = `${wallet.id} ${wallet.label}`;
  const brandKey = canonicalWalletKey(combined);
  // canonicalWalletKey echoes the normalized input when no brand matched —
  // key on the label alone in that case so connector uids don't fragment it.
  return brandKey === normalizeWalletOptionId(combined)
    ? canonicalWalletKey(wallet.label)
    : brandKey;
}

/**
 * Dedup is family-scoped: a dual-chain wallet like Phantom must survive once as
 * an EVM option and once as a Solana option, so its Solana side stays reachable.
 */
export function walletFamilyAliasKey(
  wallet: Pick<WalletAction, "id" | "label" | "family">,
): string {
  return `${wallet.family}:${walletAliasKey(wallet)}`;
}

function isGenericBrowserWallet(
  wallet: Pick<WalletAction, "provider" | "id" | "label">,
): boolean {
  const label = normalizeWalletOptionId(wallet.label);
  const id = normalizeWalletOptionId(wallet.id);
  const connectorId = normalizeWalletOptionId(wallet.provider ?? "");
  return (
    label === "browserwallet" || id === "injected" || connectorId === "injected"
  );
}

function dedupeWalletActions(actions: readonly WalletAction[]): WalletAction[] {
  const seen = new Set<string>();
  const result: WalletAction[] = [];

  for (const action of actions) {
    const key = walletFamilyAliasKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(action);
  }

  return result;
}

function walletActionIsVisible(wallet: WalletAction): boolean {
  if (wallet.id === GENERIC_BROWSER_WALLET_ID) return true;
  if (wallet.status === "unavailable") return false;
  if (wallet.family === "evm" && wallet.status !== "available") {
    const key = canonicalWalletKey(`${wallet.id} ${wallet.label}`);
    return key === "coinbase" || key === "basewallet" || key === "base";
  }
  return true;
}

/**
 * Actions that open their own surface (WalletConnect QR, provider handoffs).
 * The picker should close immediately for these instead of flashing success.
 */
export function isExternalHandoff(wallet: WalletAction): boolean {
  return wallet.kind === "walletconnect";
}

/** Every connect and sign-in option the kit offers, deduplicated and ordered for display. */
export function buildWalletActions(adapter: AomiWalletKit): WalletAction[] {
  const optionRows = [
    ...(adapter.evmWallets ?? []).map((option) => ({
      ...option,
      family: "evm" as const,
      status:
        option.status === "unavailable"
          ? ("unavailable" as const)
          : ("available" as const),
    })),
    ...(adapter.solanaWallets ?? []).map((option) => ({
      id: option.name,
      label: option.name,
      family: "svm" as const,
      kind: "solana" as const,
      status: option.ready ? ("available" as const) : ("unavailable" as const),
      iconUrl: option.iconUrl,
    })),
    ...(adapter.socialLoginOptions ?? []).map((option) => ({
      ...option,
      family: "evm" as const,
      status:
        option.status === "unavailable"
          ? ("unavailable" as const)
          : ("available" as const),
    })),
  ].map((row): WalletAction => {
    const authenticate = row.kind === "social";
    return {
      id: row.id,
      provider: "connectorId" in row ? row.connectorId : undefined,
      label: row.label,
      family: row.family,
      kind: row.kind,
      source: "option",
      status: row.status,
      actions: [
        {
          kind: authenticate ? "authenticate" : "connect",
          label: authenticate ? "Sign in" : "Connect",
        },
      ],
      iconUrl: row.iconUrl,
      ready: row.status !== "unavailable",
      description:
        row.kind === "social"
          ? "Fast account sign-in"
          : row.family === "svm"
            ? "Connect a Solana wallet"
            : "Connect an Ethereum wallet",
      actionKey: `${authenticate ? "authenticate" : "connect"}:${row.family}:${row.id}`,
      connect: async () => {
        if (authenticate) {
          if (adapter.connectSocial && row.kind === "social") {
            await adapter.connectSocial(row.id);
            return;
          }
          await adapter.connect({ family: row.family });
          return;
        }
        if (row.family === "svm") {
          if (adapter.connectSolanaWallet) {
            await adapter.connectSolanaWallet(row.id);
            return;
          }
          await adapter.connect({ family: "svm" });
          return;
        }
        if (adapter.connectEvmWallet) {
          await adapter.connectEvmWallet(row.id);
          return;
        }
        await adapter.connect({ family: "evm" });
      },
    };
  });
  const browserWallet = optionRows.find(isGenericBrowserWallet);
  const walletRowsWithoutBrowser = optionRows.filter(
    (wallet) => !isGenericBrowserWallet(wallet),
  );
  const genericBrowserWallet: WalletAction[] = adapter.canConnect
    ? [
        {
          id: GENERIC_BROWSER_WALLET_ID,
          provider: browserWallet?.provider ?? "injected",
          label: "Browser wallet",
          family: "evm",
          kind: "evm",
          source: "option",
          status: browserWallet?.status ?? "available",
          actions: [{ kind: "connect", label: "Connect" }],
          ready: browserWallet?.ready ?? true,
          iconUrl: browserWallet?.iconUrl,
          description: "Connect an Ethereum wallet",
          actionKey: "connect-browser-wallet",
          connect: async () => {
            if (browserWallet) {
              await browserWallet.connect();
              return;
            }
            if (adapter.connectEvmWallet) {
              await adapter.connectEvmWallet("injected");
              return;
            }
            await adapter.connect({ family: "evm" });
          },
        },
      ]
    : [];

  return dedupeWalletActions([
    ...walletRowsWithoutBrowser,
    ...genericBrowserWallet,
  ])
    .filter(walletActionIsVisible)
    .sort((a, b) => {
      const priority = walletDisplayRank(a) - walletDisplayRank(b);
      if (priority !== 0) return priority;
      return statusRank(a) - statusRank(b) || a.label.localeCompare(b.label);
    });
}

export function filterQuickSignInOptions(
  options: readonly WalletAction[],
  authProvider?: string,
): WalletAction[] {
  const seenSocialProviders = new Set<string>();

  return options.filter((option) => {
    const provider = quickSignInProvider(option, authProvider);
    if (option.kind === "social" && provider !== null) {
      if (seenSocialProviders.has(provider)) return false;
      seenSocialProviders.add(provider);
      return true;
    }
    return true;
  });
}

function quickSignInProvider(
  option: WalletAction,
  authProvider?: string,
): string | null {
  if (option.kind === "social") {
    return option.provider ?? authProvider ?? option.id;
  }
  return option.provider ?? null;
}

/**
 * Compact per-row indicator of the wallet's execution family (EVM vs SVM). The
 * chip stays neutral; a small family-tinted dot carries the colour cue so it
 * reads as intentional without a loud full-colour pill.
 */
