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

/** Each frame's composer, by the frame's display cache client: a page may
 * embed several, and nothing else on it hears a request. */
const composers = new WeakMap<
  object,
  (request: CapabilityMentionRequest) => void
>();

/** Ask `frame`'s composer to tag a catalog capability and take the focus. */
export function requestCapabilityMention(
  request: CapabilityMentionRequest,
  frame: object | undefined,
): void {
  if (frame) composers.get(frame)?.(request);
}

/** Receive `frame`'s requests until the returned function is called. */
export function onCapabilityMentionRequest(
  frame: object,
  receive: (request: CapabilityMentionRequest) => void,
): () => void {
  composers.set(frame, receive);
  return () => {
    if (composers.get(frame) === receive) composers.delete(frame);
  };
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
