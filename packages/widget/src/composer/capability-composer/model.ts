import type { FC } from "react";
import type { AgentMode } from "@aomi-labs/react";

export type ExecutionPolicy = AgentMode;
export type CapabilityKind = "app" | "skill" | "chain";

export type CapabilityMention = {
  key: string;
  kind: CapabilityKind;
  id: string;
  label: string;
  description?: string;
  applicationId?: string | number | null;
  appName?: string;
  chainTarget?:
    | { family: "evm"; chainId: number }
    | { family: "svm"; networkId: string };
};

export type CapabilityMentionRequest = Pick<CapabilityMention, "kind" | "id">;

/** A host's request to open the composer with one app already tagged. */
export type AppTagRequest = { app: string; applicationId?: number | null };

export const CAPABILITY_MENTION_REQUEST_EVENT =
  "aomi:capability-mention-request";

/** Ask the mounted composer to insert a catalog capability as a rich mention. */
export function requestCapabilityMention(
  request: CapabilityMentionRequest,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CapabilityMentionRequest>(
      CAPABILITY_MENTION_REQUEST_EVENT,
      { detail: request },
    ),
  );
}

export type PickerItem = CapabilityMention & {
  searchText: string;
  Icon: FC<{ className?: string }>;
  fullDescription?: string;
  chainIds?: number[];
  /** Test and local networks stay out of the picker until searched for. */
  testnet?: boolean;
};

const BARE_MENTION_LIMIT = 4;
const TESTNET_QUERY =
  /test|sepolia|devnet|holesky|goerli|amoy|fuji|local|anvil/;
const GROUPS = [
  { kind: "app", label: "Apps" },
  { kind: "skill", label: "Skills" },
  { kind: "chain", label: "Chains" },
] as const;

export type PickerGroup = {
  kind: CapabilityKind;
  label: string;
  items: PickerItem[];
};

/**
 * The picker's sections for an "@" query. A bare "@" previews a few of each
 * section so Chains isn't buried; typing searches everything. Test networks
 * appear only when searched for, and a chain named by the query comes first.
 */
export function pickerGroups(
  items: PickerItem[],
  query: string,
): PickerGroup[] {
  const needle = query.trim().toLowerCase();
  const wantsTestnets = TESTNET_QUERY.test(needle);
  const matching = items.filter(
    (item) =>
      (!item.testnet || wantsTestnets) &&
      (!needle ||
        `${item.label} ${item.searchText}`.toLowerCase().includes(needle)),
  );
  const named = (item: PickerItem) =>
    Boolean(needle) && item.label.toLowerCase().startsWith(needle);
  const groups = GROUPS.map((group) => {
    const groupItems = matching
      .filter((item) => item.kind === group.kind)
      .sort((a, b) => Number(named(b)) - Number(named(a)));
    return {
      ...group,
      items: needle ? groupItems : groupItems.slice(0, BARE_MENTION_LIMIT),
    };
  });
  const [apps, skills, chains] = groups;
  const ordered = chains.items.some(named) ? [chains, apps, skills] : groups;
  return ordered.filter((group) => group.items.length > 0);
}
