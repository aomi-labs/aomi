import type {
  LinkedVia,
  SignerChoice,
  SignerMode,
  WalletPolicy,
} from "./types";

export const SIGNER_MODES: { id: SignerMode; label: string; hint: string }[] = [
  {
    id: "manual",
    label: "Ask me",
    hint: "You approve every transaction in your wallet. Nothing signs without you.",
  },
  {
    id: "auto",
    label: "Automatic",
    hint: "This agent wallet signs for you within your rules.",
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

export function modeLabel(mode: SignerMode): string {
  return SIGNER_MODES.find((m) => m.id === mode)?.label ?? mode;
}

/** Human copy for what a change to `mode` means for this wallet. */
export function modeHintFor(mode: SignerChoice): string {
  if (mode === "manual") {
    return "A wallet popup asks you to approve each transaction. Aomi cannot sign it for you.";
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

/**
 * The per-wallet choices on the Safety tab: Ask me · Locked. A provider-managed
 * agent wallet holds no user key, so it can only be locked.
 */
export function signingChoicesFor(wallet: WalletPolicy): SignerChoice[] {
  return wallet.providerManaged ? ["denied"] : ["manual", "denied"];
}

export function unavailableReason(
  wallet: WalletPolicy,
  mode: SignerMode,
): string {
  if (mode === "auto") return "Automatic signing can't be turned on here.";
  if (wallet.providerManaged) {
    return "This is a provider-managed signer — you hold no key for it.";
  }
  return "Not available for this wallet.";
}

/** Primary wallet first; otherwise the backend's order. */
export function sortWallets(wallets: WalletPolicy[]): WalletPolicy[] {
  return [...wallets].sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return 0;
  });
}
