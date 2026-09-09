import type {
  DelegatedAccountView,
  LinkedVia,
  SignerMode,
  WalletPolicy,
} from "./types";
import { UserState } from "@aomi-labs/client";

export const SIGNER_MODES: { id: SignerMode; label: string; hint: string }[] = [
  {
    id: "manual",
    label: "Manual",
    hint: "You approve every transaction in your wallet. Nothing signs without you.",
  },
  {
    id: "client_auto",
    label: "Auto-approve",
    hint: "Your wallet auto-signs each transaction. Aomi never holds the key.",
  },
  {
    id: "auto",
    label: "Auto",
    hint: "The delegated provider authorizes transactions; Hosted submits by default. Application and sponsorship limits still apply.",
  },
  {
    id: "denied",
    label: "Locked",
    hint: "This wallet cannot sign until you change the setting.",
  },
];

const BRANDS: Record<string, string> = {
  "io.metamask": "MetaMask",
  "io.rabby": "Rabby",
  "com.coinbase.wallet": "Coinbase",
  "app.phantom": "Phantom",
  "app.backpack": "Backpack",
};

const RDNS_MARK_KEYS: Record<string, string> = {
  "io.metamask": "metamask",
  "io.rabby": "rabby",
  "com.coinbase.wallet": "coinbase",
  "app.phantom": "phantom",
  "app.backpack": "backpack",
};

const EMBEDDED_PROVIDERS: Partial<Record<LinkedVia, string>> = {
  privy: "Privy",
  para: "Para",
};

type Custody = "self" | "embedded";

export type Recon =
  | { status: "reconciled"; detail: string }
  | { status: "drifted"; detail: string; action: string };

export function modeLabel(mode: SignerMode): string {
  return SIGNER_MODES.find((m) => m.id === mode)?.label ?? mode;
}

/** Human copy for the actual signer, not just the abstract mode name. */
export function modeHintFor(wallet: WalletPolicy, mode: SignerMode): string {
  if (mode === "manual") {
    return "A wallet popup asks you to approve each transaction. Aomi cannot sign it for you.";
  }
  if (mode !== "auto") {
    return (
      SIGNER_MODES.find((candidate) => candidate.id === mode)?.hint ?? mode
    );
  }
  if (wallet.linkedVia === "privy") {
    return "Privy signs from this same wallet only after your separate one-time Aomi delegation.";
  }
  if (wallet.linkedVia === "para" && wallet.providerManaged) {
    return "Aomi signs from this separate Para agent wallet. Your Para login wallet remains manual.";
  }
  if (wallet.linkedVia === "para") {
    return "Para cannot delegate this login wallet. Create the separate Para agent wallet to use Auto.";
  }
  return SIGNER_MODES.find((candidate) => candidate.id === mode)?.hint ?? mode;
}

export function walletMarkKey(wallet: WalletPolicy): string | null {
  if (wallet.rdns && RDNS_MARK_KEYS[wallet.rdns])
    return RDNS_MARK_KEYS[wallet.rdns]!;
  if (wallet.linkedVia === "para") return "para";
  if (wallet.linkedVia === "privy") return "privy";
  return null;
}

/** Map adapter wallet names (e.g. "Rabby") to brand mark keys. */
export function walletNameToMarkKey(name?: string): string | null {
  if (!name) return null;
  const key = name
    .toLowerCase()
    .replace(/\s+wallet$/, "")
    .replace(/\s+/g, "");
  if (RDNS_MARK_KEYS[`io.${key}`]) return key;
  const aliases: Record<string, string> = {
    metamask: "metamask",
    rabby: "rabby",
    coinbase: "coinbase",
    coinbasewallet: "coinbase",
    phantom: "phantom",
    backpack: "backpack",
    rainbow: "rainbow",
    walletconnect: "walletconnect",
    para: "para",
    privy: "privy",
  };
  return aliases[key] ?? null;
}

export function walletDisplayName(wallet: WalletPolicy): string {
  if (wallet.rdns && BRANDS[wallet.rdns]) return BRANDS[wallet.rdns]!;
  const embedded = EMBEDDED_PROVIDERS[wallet.linkedVia];
  if (embedded) return embedded;
  if (wallet.linkedVia === "siwe" || wallet.linkedVia === "siws") {
    return "Self-custody";
  }
  return wallet.linkedVia.toUpperCase();
}

function custodyOf(v: LinkedVia): Custody {
  return v === "siwe" || v === "siws" ? "self" : "embedded";
}

export function walletGroupKey(wallet: WalletPolicy): Custody {
  return custodyOf(wallet.linkedVia);
}

export const CUSTODY_GROUPS: { key: Custody; label: string }[] = [
  { key: "self", label: "Self-custody wallets" },
  { key: "embedded", label: "Embedded wallets" },
];

/**
 * Which modes this wallet may hold — backend truth wins where the wire carries it.
 */
export function modeValidFor(wallet: WalletPolicy, mode: SignerMode): boolean {
  if (wallet.providerManaged)
    return mode === "denied" || (mode === "auto" && wallet.canUseAuto === true);
  if (mode === "denied" || mode === "manual") return true;
  if (mode === "client_auto") return true;
  return wallet.canUseAuto === true;
}

export function unavailableReason(
  wallet: WalletPolicy,
  mode: SignerMode,
): string {
  if (wallet.providerManaged) {
    return "This is a provider-managed signer — you hold no key for it.";
  }
  if (mode === "auto")
    return "Requires an active delegation for this exact wallet.";
  if (mode === "client_auto") return "Only available on self-custody wallets.";
  return "Not available for this wallet.";
}

export function reconcile(wallet: WalletPolicy): Recon {
  switch (wallet.desiredMode) {
    case "denied":
      return {
        status: "reconciled",
        detail: "Locked. This wallet cannot sign.",
      };
    case "manual":
      return { status: "reconciled", detail: "You approve every transaction." };
    case "client_auto":
      return {
        status: "reconciled",
        detail: "Your wallet auto-signs each transaction.",
      };
    case "auto":
      return wallet.delegationActive
        ? {
            status: "reconciled",
            detail: `Delegation valid to ${wallet.delegationExpiresLabel ?? "—"}.`,
          }
        : {
            status: "drifted",
            detail:
              "Auto is set, but the delegation is unavailable. Execution is blocked.",
            action: "Renew delegation",
          };
  }
}

export function findDelegationForWallet(
  delegatedAccounts: DelegatedAccountView[],
  wallet: WalletPolicy,
): DelegatedAccountView | undefined {
  const matching = delegatedAccounts.filter(
    (delegation) =>
      UserState.sameAddress(delegation.address, {
        chain: wallet.chain,
        address: wallet.address,
      }) && delegation.providerKey === wallet.provider,
  );
  return (
    matching.find((delegation) => delegation.status === "active") ?? matching[0]
  );
}

export function walletStatusLabel(
  wallet: WalletPolicy,
  recon: Recon,
  pending: boolean,
): string {
  if (pending) return "Awaiting signature";
  if (recon.status === "drifted") return "Delegation expired";
  if (wallet.desiredMode === "auto" && wallet.delegationActive) {
    return `Delegation valid to ${wallet.delegationExpiresLabel ?? "—"}`;
  }
  return modeLabel(wallet.desiredMode);
}

export function sortWallets(wallets: WalletPolicy[]): WalletPolicy[] {
  return [...wallets].sort((a, b) => {
    const aDrift = reconcile(a).status === "drifted" ? 0 : 1;
    const bDrift = reconcile(b).status === "drifted" ? 0 : 1;
    if (aDrift !== bDrift) return aDrift - bDrift;
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return 0;
  });
}
