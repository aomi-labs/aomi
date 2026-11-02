import {
  mentionGroups,
  type AgentMode,
  type CapabilityKind,
  type MentionGroup,
} from "@aomi-labs/client";
import type { FC } from "react";

export type ExecutionPolicy = AgentMode;
export type { CapabilityKind };

export type CapabilityMention = {
  key: string;
  kind: CapabilityKind;
  id: string;
  label: string;
  description?: string;
  applicationId?: string | number | null;
  appName?: string;
  /** A wallet: the `w_N` id of each of its addresses (EVM, SVM). */
  walletIds?: string[];
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
