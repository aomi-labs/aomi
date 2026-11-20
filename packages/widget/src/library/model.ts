import type {
  AomiPackage,
  AomiPackageFamily,
  AomiPackageSlot,
  AomiPublicPackage,
} from "@aomi-labs/client";
import type { ComponentType } from "react";
import {
  BadgeCheck,
  Box,
  KeyRound,
  Package,
  PenLine,
  Send,
  ShieldCheck,
  Tag,
  ToggleRight,
  type LucideIcon,
} from "lucide-react";
import {
  ArbitrumIcon,
  ArcIcon,
  BaseIcon,
  EthereumIcon,
  MegaETHIcon,
  MonadIcon,
  OptimismIcon,
  PolygonIcon,
  RobinhoodIcon,
  SepoliaIcon,
  SolanaIcon,
} from "@/icons/chain-icons";

type IconComponent = ComponentType<{ className?: string }>;

export type LibraryView =
  | "all"
  | "on"
  | "verified"
  | "not_verified"
  | "connect";
export type LibraryGroup =
  | "agent"
  | "private"
  | "verified"
  | "other"
  | "connect";

export const NAV_ITEMS: { id: LibraryView; label: string; icon: LucideIcon }[] =
  [
    { id: "all", label: "All packages", icon: Package },
    { id: "on", label: "On", icon: ToggleRight },
    { id: "verified", label: "Verified", icon: BadgeCheck },
    { id: "not_verified", label: "Not verified", icon: Box },
    { id: "connect", label: "To connect", icon: KeyRound },
  ];

export const GROUP_TITLES: Record<LibraryGroup, (agent: string) => string> = {
  agent: (agent) => `Used by ${agent}`,
  private: () => "Added with a code",
  verified: () => "Verified",
  other: () => "Not verified",
  connect: () => "To connect",
};

/** The views a guest has: nothing that depends on an account. */
export const GUEST_VIEWS: readonly LibraryView[] = [
  "all",
  "verified",
  "not_verified",
];

/** A signed-in account's row, with its choices and keys; a guest's rows are public only. */
export function isAccountRow(row: AomiPublicPackage): row is AomiPackage {
  return "package_id" in row;
}

/** Agent-listed first, then private (added with a code), then verified, then the rest. */
export function packageGroup(row: AomiPublicPackage): LibraryGroup {
  if (isAccountRow(row) && row.agent_listed) return "agent";
  if (isAccountRow(row) && !row.listed) return "private";
  return row.verified ? "verified" : "other";
}

const GROUP_ORDER: readonly LibraryGroup[] = [
  "agent",
  "private",
  "verified",
  "other",
];

export function groupPackages<Row extends AomiPublicPackage>(
  rows: readonly Row[],
): { group: LibraryGroup; rows: Row[] }[] {
  const seen = new Set<string>();
  const groups = new Map<LibraryGroup, Row[]>(
    GROUP_ORDER.map((group) => [group, []]),
  );
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    groups.get(packageGroup(row))!.push(row);
  }
  return GROUP_ORDER.flatMap((group) => {
    const members = groups.get(group)!;
    return members.length ? [{ group, rows: members }] : [];
  });
}

export function personSlots(row: AomiPackage): AomiPackageSlot[] {
  return row.slots.filter((slot) => slot.owner === "person");
}

/** A required person key is missing: the row shows Connect before its switch. */
export function needsConnect(row: AomiPackage): boolean {
  return personSlots(row).some(
    (slot) => slot.required && slot.status === "missing",
  );
}

export function inView(row: AomiPublicPackage, view: LibraryView): boolean {
  switch (view) {
    case "all":
      return true;
    case "on":
      return isAccountRow(row) && row.enabled;
    case "verified":
      return row.verified;
    case "not_verified":
      return !row.verified;
    case "connect":
      return isAccountRow(row) && needsConnect(row);
  }
}

export function matches(
  row: AomiPublicPackage,
  filter: {
    view: LibraryView;
    chain: string | null;
    tag: string | null;
    query: string;
  },
): boolean {
  const needle = filter.query.trim().toLowerCase();
  if (filter.chain && !row.chains.includes(filter.chain)) return false;
  if (filter.tag && !row.tags.includes(filter.tag)) return false;
  if (needle)
    return [
      row.display_name,
      row.id,
      row.description,
      ...row.skills.map((skill) => skill.id),
    ].some((text) => text.toLowerCase().includes(needle));
  return inView(row, filter.view);
}

/** `publisher/name` → publisher. */
export function publisher(row: AomiPublicPackage): string {
  return row.id.split("/")[0] ?? row.id;
}

export interface FilterItem {
  id: string;
  label: string;
  icon: IconComponent;
}

/** The chain names the backend resolves, in the order the Library lists them. */
const CHAINS: Record<string, { label: string; icon?: IconComponent }> = {
  ethereum: { label: "Ethereum", icon: EthereumIcon },
  base: { label: "Base", icon: BaseIcon },
  arbitrum: { label: "Arbitrum", icon: ArbitrumIcon },
  optimism: { label: "Optimism", icon: OptimismIcon },
  polygon: { label: "Polygon", icon: PolygonIcon },
  megaeth: { label: "MegaETH", icon: MegaETHIcon },
  robinhood: { label: "Robinhood Chain", icon: RobinhoodIcon },
  monad: { label: "Monad", icon: MonadIcon },
  arc: { label: "Arc", icon: ArcIcon },
  solana: { label: "Solana", icon: SolanaIcon },
  sepolia: { label: "Sepolia", icon: SepoliaIcon },
  "robinhood-testnet": { label: "Robinhood Testnet", icon: RobinhoodIcon },
  "monad-testnet": { label: "Monad Testnet", icon: MonadIcon },
  "arc-testnet": { label: "Arc Testnet", icon: ArcIcon },
  "unifi-testnet": { label: "Unifi Testnet" },
};

const TAGS: Record<string, string> = {
  lending: "Lending",
  dex: "DEX",
  bridge: "Bridge",
  staking: "Staking",
  perps: "Perps",
  prediction: "Prediction",
  payments: "Payments",
  yield: "Yield",
  rwa: "RWA",
  nft: "NFT",
  data: "Data",
  social: "Social",
  wallet: "Wallet",
};

/** A chain name as the Library shows it; a name it does not know is shown as sent. */
export function chainItem(name: string): {
  id: string;
  label: string;
  icon?: IconComponent;
} {
  const chain = CHAINS[name];
  return { id: name, label: chain?.label ?? name, icon: chain?.icon };
}

/** `ids` known to `order` first, in its order, then the rest by name. */
function ordered(ids: Iterable<string>, order: Record<string, unknown>) {
  const known = Object.keys(order);
  const rank = (id: string) =>
    known.includes(id) ? known.indexOf(id) : known.length;
  return [...new Set(ids)].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
}

/** The network filter: every chain some row works on. */
export function networkItems(rows: readonly AomiPublicPackage[]): FilterItem[] {
  return ordered(
    rows.flatMap((row) => row.chains),
    CHAINS,
  ).map((name) => {
    const chain = chainItem(name);
    return { ...chain, icon: chain.icon ?? Package };
  });
}

/** The tag filter: every tag some row carries. */
export function tagItems(rows: readonly AomiPublicPackage[]): FilterItem[] {
  return ordered(
    rows.flatMap((row) => row.tags),
    TAGS,
  ).map((id) => ({ id, label: TAGS[id] ?? id, icon: Tag }));
}

const FAMILY_WORDS: Record<AomiPackageFamily, string> = {
  evm: "EVM",
  svm: "Solana",
};

export interface WalletLine {
  kind: "transactions" | "signature" | "guard";
  icon: LucideIcon;
  title: string;
  detail: string;
}

/** What the package may ask of the person's wallet; empty when nothing. */
export function walletLines(row: AomiPackage): WalletLine[] {
  const { transactions, signatures } = row.envelope;
  const signs = new Set(
    signatures.map((signature) =>
      signature.kind.endsWith("-message") ? "a message" : "typed data",
    ),
  );
  const guards = row.guards ?? [];
  return [
    ...(transactions.length
      ? [
          {
            kind: "transactions" as const,
            icon: Send,
            title: `Prepares ${transactions.map((family) => FAMILY_WORDS[family]).join(" and ")} transactions`,
            detail: "You approve each one in your wallet.",
          },
        ]
      : []),
    ...[...signs].map((what) => ({
      kind: "signature" as const,
      icon: PenLine,
      title: `Asks you to sign ${what}`,
      detail: "You sign each one in your wallet.",
    })),
    ...(guards.length
      ? [
          {
            kind: "guard" as const,
            icon: ShieldCheck,
            title: "Checked by a guard before you approve",
            detail: guards.join(", "),
          },
        ]
      : []),
  ];
}

/** `sha256:7c21…9a` → `7c21…9a`. */
export function shortDigest(digest: string): string {
  const hex = digest.slice(digest.indexOf(":") + 1);
  return hex.length > 8 ? `${hex.slice(0, 4)}…${hex.slice(-2)}` : hex;
}

/** The one-time notice is acknowledged per device, per package and envelope. */
export function noticeKey(row: AomiPackage): string {
  return `aomi:package-notice:${row.package_id}:${row.envelope.hash}`;
}

export function noticeSeen(row: AomiPackage): boolean {
  try {
    return globalThis.localStorage?.getItem(noticeKey(row)) === "1";
  } catch {
    return false;
  }
}

export function markNoticeSeen(row: AomiPackage): void {
  try {
    globalThis.localStorage?.setItem(noticeKey(row), "1");
  } catch {
    /* Storage blocked: the notice shows again next time. */
  }
}

/** The HTTP status an account call failed with; 0 when there is none. */
function statusOf(cause: unknown): number {
  return cause && typeof cause === "object" && "status" in cause
    ? Number(cause.status)
    : 0;
}

/** Why the Library did not load. Only `failed` is worth a retry. */
export type LoadFailure = "session_ended" | "failed";

/** A signed-in account's read refused with 401: the session ended. */
export function loadFailure(cause: unknown): LoadFailure {
  return statusOf(cause) === 401 ? "session_ended" : "failed";
}

/** A mutation error in words, with the agent-listed refusal named. */
export function explainMutationError(cause: unknown, agent: string): string {
  const status = statusOf(cause);
  if (status === 409) return `${agent} uses this package, so it stays on.`;
  if (status === 401) return "Sign in to change your packages.";
  return "Couldn’t update the package. Please try again.";
}

export function explainActivateError(cause: unknown): string {
  const status = statusOf(cause);
  if (status === 404) return "That code isn’t valid. Check it and try again.";
  if (status === 401) return "Sign in to add a private package.";
  return "Couldn’t add the package. Please try again.";
}
