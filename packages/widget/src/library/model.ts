import type {
  AomiPackage,
  AomiPackageEnvelope,
  AomiPackageFamily,
  AomiPackageSlot,
} from "@aomi-labs/client";
import {
  Hexagon,
  KeyRound,
  Orbit,
  Package,
  ShieldCheck,
  ShieldQuestion,
  ToggleRight,
  type LucideIcon,
} from "lucide-react";

export type LibraryView =
  | "all"
  | "on"
  | "verified"
  | "not_verified"
  | "connect";
export type LibraryGroup = "agent" | "verified" | "other";

export const NAV_ITEMS: { id: LibraryView; label: string; icon: LucideIcon }[] =
  [
    { id: "all", label: "All packages", icon: Package },
    { id: "on", label: "On", icon: ToggleRight },
    { id: "verified", label: "Verified", icon: ShieldCheck },
    { id: "not_verified", label: "Not verified", icon: ShieldQuestion },
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
  verified: () => "Verified",
  other: () => "Not verified",
};

/** Agent-listed first, then other verified, then the rest; one row per package id. */
export function packageGroup(row: AomiPackage): LibraryGroup {
  if (row.agent_listed) return "agent";
  return row.verified ? "verified" : "other";
}

const GROUP_ORDER: readonly LibraryGroup[] = ["agent", "verified", "other"];

export function groupPackages(
  rows: readonly AomiPackage[],
): { group: LibraryGroup; rows: AomiPackage[] }[] {
  const seen = new Set<number>();
  const groups = new Map<LibraryGroup, AomiPackage[]>(
    GROUP_ORDER.map((group) => [group, []]),
  );
  for (const row of rows) {
    if (seen.has(row.package_id)) continue;
    seen.add(row.package_id);
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

export function inView(row: AomiPackage, view: LibraryView): boolean {
  switch (view) {
    case "all":
      return true;
    case "on":
      return row.enabled;
    case "verified":
      return row.verified;
    case "not_verified":
      return !row.verified;
    case "connect":
      return needsConnect(row);
  }
}

export function matches(
  row: AomiPackage,
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
export function publisher(row: AomiPackage): string {
  return row.id.split("/")[0] ?? row.id;
}

/** The brand key for curated artwork: the package name without its publisher. */
export function brandId(row: AomiPackage): string {
  return row.id.split("/").at(-1) ?? row.id;
}

export function reasonText(row: AomiPackage, agent: string): string {
  switch (row.reason) {
    case "agent_listed":
      return `${agent} uses it, so it stays on.`;
    case "verified_default":
      return "Verified, so it is on until you switch it off.";
    case "chosen_on":
      return "On because you switched it on.";
    case "chosen_off":
      return "Off because you switched it off.";
    case "off_by_default":
      return "Not verified. Off until you switch it on.";
  }
}

export function contentsLine(row: AomiPackage): string {
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

export function explainLoadError(cause: unknown): string {
  const fallback = "Couldn’t load packages. Please try again.";
  const raw = cause instanceof Error ? cause.message.trim() : "";
  // A failed proxy can return its entire HTML error document. Never put that
  // implementation detail into the modal (or let it stretch the layout).
  if (!raw || raw.length > 240 || raw.startsWith("<")) return fallback;
  return raw;
}

/** A mutation error in words, with the agent-listed refusal named. */
export function explainMutationError(cause: unknown, agent: string): string {
  const status =
    cause && typeof cause === "object" && "status" in cause
      ? Number(cause.status)
      : 0;
  if (status === 409) return `${agent} uses this package, so it stays on.`;
  if (status === 401) return "Sign in to change your packages.";
  const raw = cause instanceof Error ? cause.message.trim() : "";
  return raw && raw.length <= 240 && !raw.startsWith("<")
    ? raw
    : "Couldn’t update the package. Please try again.";
}

export function explainActivateError(cause: unknown): string {
  const status =
    cause && typeof cause === "object" && "status" in cause
      ? Number(cause.status)
      : 0;
  if (status === 404) return "That code isn’t valid. Check it and try again.";
  if (status === 401) return "Sign in to add a private package.";
  return "Couldn’t add the package. Please try again.";
}
