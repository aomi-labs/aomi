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
};
