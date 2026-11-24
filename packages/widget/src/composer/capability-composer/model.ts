import {
  mentionGroups,
  type CapabilityKind,
  type MentionGroup,
} from "@aomi-labs/client";
import type { AgentMode } from "@aomi-labs/react";
import type { FC } from "react";

export type ExecutionPolicy = AgentMode;
export type { CapabilityKind };

export type CapabilityMention = {
  key: string;
  kind: CapabilityKind;
  id: string;
  label: string;
  description?: string;
  agentName?: string;
  /** A wallet: the `w_N` id of each of its addresses (EVM, SVM). */
  walletIds?: string[];
  chainTarget?:
    | { family: "evm"; chainId: number }
    | { family: "svm"; networkId: string };
};

/** A tag to insert. An agent's id is its `publisher/name`. */
export type CapabilityMentionRequest = Pick<CapabilityMention, "kind" | "id">;

/** A host's request to open the composer with one agent already tagged. */
export type AgentTagRequest = { agent: string };

export const CAPABILITY_MENTION_REQUEST_EVENT =
  "aomi:capability-mention-request";

/**
 * Ask a frame's composer to tag a catalog capability and take the focus.
 * `frame` is that frame's display cache client: a page may embed several.
 */
export function requestCapabilityMention(
  request: CapabilityMentionRequest,
  frame: unknown,
): void {
  window.dispatchEvent(
    new CustomEvent(CAPABILITY_MENTION_REQUEST_EVENT, {
      detail: { request, frame },
    }),
  );
}

/** What a person calls each kind. */
export const MENTION_NOUN: Record<CapabilityKind, string> = {
  agent: "Agent",
  package: "Package",
  chain: "Chain",
  wallet: "Wallet",
};

export type PickerItem = CapabilityMention & {
  disabled?: boolean;
  searchText: string;
  Icon: FC<{ className?: string }>;
  fullDescription?: string;
  chainIds?: number[];
  /** Test and local networks stay out of the picker until searched for. */
  testnet?: boolean;
};

export type PickerGroup = MentionGroup<PickerItem>;

/** The picker's sections for an "@" query; the CLI ranks the same way. */
export function pickerGroups(
  items: PickerItem[],
  query: string,
): PickerGroup[] {
  return mentionGroups(items, query);
}
