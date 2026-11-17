"use client";

import { cn } from "@/lib/cn";
import type { ReactNode, FC } from "react";
import { NetworkSelect } from "./network-select";
import { ModelSelect } from "./model-select";
import { SafetySelect } from "./safety-select";
import { ApiKeyInput } from "./api-key-input";
import { ConnectButton } from "@/wallet/connect-button";
import { SecretInput } from "@/account/agent-secrets/secret-input";
import type { AomiRoutingConfig } from "./routing";
import type { AgentTagRequest } from "@/composer/capability-composer/model";

// =============================================================================
// Types
// =============================================================================

export type ControlBarProps = {
  className?: string;
  /** Custom controls to render alongside built-in ones */
  children?: ReactNode;
  /** Hide the model selector */
  hideModel?: boolean;
  /** Hide the per-chat transaction safety selector (signed-in accounts only) */
  hideSafety?: boolean;
  /** @deprecated There is no agent selector; pin a Direct agent with `routing`. */
  hideAgent?: boolean;
  /**
   * Host-owned agent routing with no user-facing control. Chats run
   * `defaultMode`: Auto unless the host allows only Direct.
   */
  routing?: AomiRoutingConfig;
  /** Account-enabled agent names offered by the composer capability picker. */
  enabledAgentIds?: readonly string[];
  /** Open the composer with this agent tagged, as if chosen from the + picker. */
  initialAgentTag?: AgentTagRequest;
  /** Hide the API key input */
  hideApiKey?: boolean;
  /** Hide the wallet connect button (default: true) */
  hideWallet?: boolean;
  /** Hide the network selector (default: false) */
  hideNetwork?: boolean;
  /** Hide the secrets input */
  hideSecrets?: boolean;
};

// =============================================================================
// Main Component
// =============================================================================

export const ControlBar: FC<ControlBarProps> = ({
  className,
  children,
  hideModel = false,
  hideSafety = false,
  hideApiKey = false,
  hideWallet = true,
  hideNetwork = false,
  hideSecrets = false,
}) => {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {!hideNetwork && <NetworkSelect />}
      {!hideModel && <ModelSelect />}
      {!hideSafety && <SafetySelect />}
      {!hideWallet && <ConnectButton />}
      {!hideSecrets && <SecretInput />}
      {children}
      {!hideApiKey && <ApiKeyInput />}
    </div>
  );
};

// =============================================================================
// Re-exports for granular usage
// =============================================================================

export { ModelSelect, type ModelSelectProps } from "./model-select";
export { SafetySelect, type SafetySelectProps } from "./safety-select";
export type { AomiRoutingConfig, DirectRoutingAgent } from "./routing";
export { ApiKeyInput, type ApiKeyInputProps } from "./api-key-input";
export {
  ConnectButton,
  type ConnectButtonProps,
} from "@/wallet/connect-button";
export { NetworkSelect, type NetworkSelectProps } from "./network-select";
export {
  SecretInput,
  type SecretInputProps,
} from "@/account/agent-secrets/secret-input";
