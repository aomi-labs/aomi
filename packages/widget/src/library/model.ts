import type {
  AomiPackage,
  AomiPackageEnvelope,
  AomiPackageFamily,
  AomiPackageSlot,
  AomiPublicPackage,
} from "@aomi-labs/client";
import {
  BadgeCheck,
  Box,
  Hexagon,
  KeyRound,
  Orbit,
  Package,
  ToggleRight,
  type LucideIcon,
} from "lucide-react";

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

export const FAMILIES: {
  id: AomiPackageFamily;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "evm", label: "EVM", icon: Hexagon },
  { id: "svm", label: "Solana", icon: Orbit },
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

/** Rows a group shows before its "Show N more". */
export const GROUP_PREVIEW = 5;

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

/** At least one person key is in and no required one is missing. */
export function connected(row: AomiPackage): boolean {
  const slots = personSlots(row);
  return slots.some((slot) => slot.status === "ready") && !needsConnect(row);
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
    family: AomiPackageFamily | null;
    query: string;
  },
): boolean {
  const needle = filter.query.trim().toLowerCase();
  if (filter.family && !row.families.includes(filter.family)) return false;
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

/** The brand key for curated artwork: the package name without its publisher. */
export function brandId(row: AomiPublicPackage): string {
  return row.id.split("/").at(-1) ?? row.id;
}

export function reasonText(row: AomiPackage, agent: string): string {
  switch (row.reason) {
    case "agent_listed":
      return `${agent} uses it, so it stays on.`;
    case "verified_default":
      return "On until you switch it off.";
    case "chosen_on":
      return "On because you switched it on.";
    case "chosen_off":
      return "Off because you switched it off.";
    case "off_by_default":
      return "Off until you switch it on.";
  }
}

export function contentsLine(row: AomiPublicPackage): string {
  const skills = `${row.skills.length} skill${row.skills.length === 1 ? "" : "s"}`;
  return `${skills} · ${row.tool_count} tool${row.tool_count === 1 ? "" : "s"}`;
}

const CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  143: "Monad",
  8453: "Base",
  42161: "Arbitrum",
  5_042_002: "Arc",
};

export function chainLabel(id: number): string {
  return CHAIN_LABELS[id] ?? `chain ${id}`;
}

const FAMILY_NAMES: Record<AomiPackageFamily, string> = {
  evm: "EVM chains",
  svm: "Solana",
};

/** "Can ask you to" lines from the envelope, in plain words. */
export function askLines(envelope: AomiPackageEnvelope): string[] {
  return [
    ...envelope.transactions.map(
      (family) => `Approve transactions on ${FAMILY_NAMES[family]}`,
    ),
    ...envelope.signatures.map((signature) => {
      const what = signature.primary_types.length
        ? signature.primary_types.join(", ")
        : signature.kind === "evm-typed-data"
          ? "typed data"
          : "messages";
      const chains = [
        ...new Set(signature.domains.map((domain) => domain.chain_id)),
      ].map(chainLabel);
      return `Sign ${what}${chains.length ? ` on ${chains.join(", ")}` : ""}`;
    }),
  ];
}

/** The inspector's line before a not verified package is first switched on. */
export function noticeText(row: AomiPackage): string {
  const { hosts, transactions, signatures } = row.envelope;
  const can = [
    ...(hosts.length ? [`can reach ${hosts.join(", ")}`] : []),
    ...(transactions.length
      ? ["can ask you to approve transactions"]
      : signatures.length
        ? ["can ask you to sign"]
        : []),
  ];
  return can.length
    ? `Not verified by Aomi. It ${can.join(" and ")}.`
    : "Not verified by Aomi. It reaches no outside service.";
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
