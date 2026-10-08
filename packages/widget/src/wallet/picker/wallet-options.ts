import type { AomiWalletKit, WalletFamily } from "@/wallet/types";
import {
  canonicalWalletKey,
  normalizeWalletOptionId,
} from "@/wallet/catalog/wallet-branding";

/** One way to connect one chain of a wallet app. */
export type WalletConnectOption = {
  id: string;
  label: string;
  family: WalletFamily;
  kind: "evm" | "solana" | "walletconnect";
  iconUrl?: string;
  connect: () => Promise<void>;
};

/** One wallet app in the sheet; Phantom is one choice with both chains. */
export type WalletChoice = {
  /** Canonical brand key, e.g. "rabby". */
  id: string;
  label: string;
  iconUrl?: string;
  families: WalletFamily[];
  options: Partial<Record<WalletFamily, WalletConnectOption>>;
  /** Installed in this browser, or reached another way (QR, SDK). */
  section: "detected" | "more";
  description: string;
};

const GENERIC_BROWSER_WALLET = "browserwallet";

const BRAND_ORDER = [
  "metamask",
  "rabby",
  "phantom",
  "solflare",
  "backpack",
  "walletconnect",
  "coinbase",
  "base",
  GENERIC_BROWSER_WALLET,
];

function brandOf(option: { id: string; label: string }): string {
  const key = canonicalWalletKey(`${option.id} ${option.label}`);
  // An unknown brand echoes its input; key it on the label alone so connector
  // uids don't split one wallet into several.
  if (key !== normalizeWalletOptionId(`${option.id} ${option.label}`))
    return key;
  const label = canonicalWalletKey(option.label);
  return label === "injected" ? GENERIC_BROWSER_WALLET : label;
}

function familiesText(families: readonly WalletFamily[]): string {
  return families.length > 1
    ? "EVM and SVM"
    : families[0] === "svm"
      ? "SVM"
      : "EVM";
}

/** Every wallet app the kit can connect, one choice per app. */
export function buildWalletChoices(kit: AomiWalletKit): WalletChoice[] {
  const options: WalletConnectOption[] = [
    ...(kit.evmWallets ?? [])
      .filter((option) => option.status !== "unavailable")
      .map(
        (option): WalletConnectOption => ({
          id: option.id,
          label: option.label,
          family: "evm",
          kind: option.kind === "walletconnect" ? "walletconnect" : "evm",
          iconUrl: option.iconUrl,
          connect: () =>
            kit.connectEvmWallet
              ? kit.connectEvmWallet(option.id)
              : kit.connect({ family: "evm" }),
        }),
      ),
    ...(kit.solanaWallets ?? [])
      .filter((wallet) => wallet.ready)
      .map(
        (wallet): WalletConnectOption => ({
          id: wallet.name,
          label: wallet.name,
          family: "svm",
          kind: "solana",
          iconUrl: wallet.iconUrl,
          connect: () =>
            kit.connectSolanaWallet
              ? kit.connectSolanaWallet(wallet.name)
              : kit.connect({ family: "svm" }),
        }),
      ),
  ];
  const choices = new Map<string, WalletChoice>();
  for (const option of options) {
    const id = brandOf(option);
    const choice = choices.get(id);
    if (choice) {
      if (choice.options[option.family]) continue;
      choice.options[option.family] = option;
      choice.families.push(option.family);
      choice.description = familiesText(choice.families);
      continue;
    }
    const more =
      option.kind === "walletconnect" ||
      id === "coinbase" ||
      id === "base" ||
      id === GENERIC_BROWSER_WALLET;
    choices.set(id, {
      id,
      label: id === GENERIC_BROWSER_WALLET ? "Browser wallet" : option.label,
      iconUrl: option.iconUrl,
      families: [option.family],
      options: { [option.family]: option },
      section: more ? "more" : "detected",
      description:
        option.kind === "walletconnect"
          ? "Scan with a phone wallet"
          : familiesText([option.family]),
    });
  }
  const detectedEvm = [...choices.values()].some(
    (choice) => choice.section === "detected" && choice.options.evm,
  );
  return [...choices.values()]
    .filter((choice) => !(choice.id === GENERIC_BROWSER_WALLET && detectedEvm))
    .sort((left, right) => rank(left.id) - rank(right.id));
}

function rank(id: string): number {
  const index = BRAND_ORDER.indexOf(id);
  return index === -1 ? BRAND_ORDER.length - 1 : index;
}

/** Same app, ignoring connector ids and numbering. */
export function sameWalletBrand(left?: string, right?: string): boolean {
  return Boolean(
    left && right && canonicalWalletKey(left) === canonicalWalletKey(right),
  );
}
