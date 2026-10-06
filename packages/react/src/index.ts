// =============================================================================
// API Client (re-exported from @aomi-labs/client)
// =============================================================================
export { AomiClient } from "@aomi-labs/client";
export type {
  AgentMode,
  AgentTarget,
  AomiClientOptions,
} from "@aomi-labs/client";
export type {
  Action,
  ActionRequest,
  ActionResult,
  AomiAppDescriptor,
  AomiPlatformFilter,
  AomiSecretSlot,
  NativeWalletExecutionPolicy,
  NativeWalletSponsorship,
  SponsorshipPaymasterServiceContext,
  WalletCapabilities,
  WalletEip712Payload,
  WalletSolanaSignMessagePayload,
  WalletSolanaSignPayload,
  WalletTxPayload,
  ViemSignMessageArgs,
} from "@aomi-labs/client";
export {
  toViemSignTypedDataArgs,
  toAAWalletCalls,
  toAAWalletCall,
  appendFeeCallToPayload,
  buildFeeAAWalletCall,
  normalizeSimulatedFee,
  MAX_AUTO_FEE_WEI,
  executeWalletCalls,
  parseChainId,
  aaModeFromExecutionKind,
  toViemSignMessageArgs,
  normalizeAppDescriptor,
  appIdentityKey,
} from "@aomi-labs/client";

// =============================================================================
// Runtime Provider
// =============================================================================
export { AomiRuntimeProvider } from "./runtime/aomi-runtime";
export type { AomiRuntimeProviderProps } from "./runtime/aomi-runtime";

// =============================================================================
// Unified Runtime API
// =============================================================================
export {
  AomiRuntimeApiProvider,
  useAomiRuntime,
  useOptionalAomiRuntime,
} from "./interface";
export type { AomiRuntimeApi } from "./interface";
export type { AomiInferenceFundingSource } from "@aomi-labs/client";

// =============================================================================
// Handler Hooks
// =============================================================================
export { useActions } from "./actions/use-actions";

// =============================================================================
// User Context (wallet/user state)
// =============================================================================
export {
  useUser,
  ExtUserProvider,
  UserState,
} from "./contexts/ext-user-context";

// User config type (for render prop pattern)
export type { UserConfig } from "./contexts/ext-user-context";

// =============================================================================
// Thread Context (for UI components)
// =============================================================================
export {
  useThreadContext,
  useCurrentThreadMetadata,
  ThreadContextProvider,
} from "./contexts/thread-context";
export type { ThreadContext } from "./contexts/thread-context";
export type {
  ModelSelectionMode,
  ThreadMetadata,
  ThreadControlState,
} from "./state/thread-store";
export {
  EMPTY_TASK_RUNS,
  selectTaskRuns,
  useTaskRun,
  useThreadTaskRuns,
} from "./runtime/task-runs";
export type {
  TaskRunState,
  TaskRunStatus,
  TaskRunStep,
  ThreadTaskRuns,
} from "./runtime/task-runs";
export { initThreadControl } from "./state/thread-store";

// =============================================================================
// Utilities
// =============================================================================
export { cn } from "./class-names";
export { formatAddress } from "./format-address";
export {
  getNetworkName,
  getChainInfo,
  SUPPORTED_CHAINS,
  type ChainInfo,
} from "./chains";
export {
  projectAssistantMessages,
  walletContinuationPending,
} from "./runtime/message-projection";
export { resolveAutoModel } from "./control/model-selection";

// =============================================================================
// Notification Context (for toast UI)
// =============================================================================
export {
  useNotification,
  NotificationContextProvider,
  type Notification,
  type NotificationType,
  type NotificationData as ShowNotificationParams,
  type NotificationContextApi as NotificationContextValue,
  type NotificationContextProviderProps,
} from "./contexts/notification-context";

// =============================================================================
// Control Context (model/app/api-key state)
// =============================================================================
export {
  useControl,
  useApiKey,
  useByok,
  useAppSecrets,
  useAuthEndpoints,
  usePerThreadControl,
  ControlContextProvider,
  type ControlState,
  type ControlContextApi,
  type ControlContextProviderProps,
  type StoredByokKey,
} from "./contexts/control-context";

export { AomiChatBoundary } from "./runtime/assistant-runtime-boundary";
export { useChatView, useChatViewFlag } from "./state/use-chat-view";

export {
  fetchDisplayQuery,
  useAomiDisplayCache,
  useDisplayQuery,
} from "./query/display-cache";
export type {
  DisplayCache,
  DisplayQuery,
  DisplayResource,
  RuntimeAccount,
} from "./query/display-cache";
export type { DisplayPersistence } from "./query/display-persistence";
export { displayQueries } from "./query/queries";
