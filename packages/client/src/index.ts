// =============================================================================
// Client
// =============================================================================

export { AomiClient, secretNamesFrom } from "./client";
export {
  AccountCreditsTransport,
  AccountTransport,
  MAX_CREDIT_TOP_UP,
  MICROUSD_PER_CREDIT,
  MIN_CREDIT_TOP_UP,
} from "./account/credits";
export type {
  AomiCreditActivity,
  AomiCreditListOptions,
  AomiCreditPaymentReceipt,
  AomiCreditPosition,
  AomiCreditTopUpOptions,
  AomiCreditTopUpResult,
} from "./account/credits";
export { AomiCreditApiError } from "./account/credits";
export { AgentApiError, AgentTransport } from "./agent/transport";
export {
  EvmPipelineTransport,
  PipelineApiError,
  PipelineAppsTransport,
  PipelineOperationTransport,
  PipelineSkillTransport,
  PipelineSkillsTransport,
  PipelineTransport,
  SvmPipelineTransport,
} from "./pipeline/transport";
export {
  PipelineSchemaError,
  validatePipelineArguments,
} from "./pipeline/schema";
export type {
  EvmCall,
  EvmCallInput,
  EvmCommitResult,
  EvmDirectInput,
  EvmPresentedAction,
  EvmSimulatedBuild,
  EvmStageActionInput,
  EvmStageInput,
  EvmStagedAction,
  EvmStagedBuild,
  PipelineActionSummary,
  PipelineBalanceChange,
  PipelineCommitOptions,
  PipelineDirectory,
  PipelineDirectoryEntry,
  PipelineDirectoryEntryKind,
  PipelineFeeEstimate,
  PipelineFilesystemResource,
  PipelineGasEstimate,
  PipelineGuardResult,
  PipelineInvokeOptions,
  PipelineJsonSchema,
  PipelineLog,
  PipelineOperationBuildInput,
  PipelineOperationDescriptor,
  PipelineOperationInvocation,
  PipelineSimulation,
  PipelineSimulationStatus,
  PipelineTransactionReceipt,
  SvmAccountMeta,
  SvmCommitResult,
  SvmDirectInput,
  SvmInstruction,
  SvmPresentedAction,
  SvmSimulatedBuild,
  SvmStageInput,
  SvmStagedAction,
  SvmStagedBuild,
  SvmTransaction,
} from "./pipeline/types";
export type {
  Action,
  ActionRequest,
  ActionResult,
  ErrorEvent,
  Event,
  EventPage,
  InterruptIntent,
  MessageEvent,
  RespondToActionIntent,
  Session as AgentSession,
  SessionPage,
  StartTurnIntent,
  AomiInferenceFundingSource,
  TaskActivityEvent,
  TaskCompletedEvent,
  TaskPhaseEvent,
  TaskStartedEvent,
  TitleEvent,
  ToolCompleteEvent,
  ToolUpdateEvent,
  TurnState,
  TurnStateChangedEvent,
} from "./agent/types";
export { ActionHandler } from "./actions";
export type {
  ActionAttempt,
  ActionAttemptState,
  ActionCapabilities,
  ActionCapability,
  ActionHandlerEvents,
  ActionResponder,
  ActionResultFor,
  ActionType,
} from "./actions";
export {
  authorizationChallenge,
  authorizationCommit,
  ensureSvmWalletBound,
  ensureSvmWalletBoundVia,
  isUnboundWalletError,
  posterFromClient,
  createAomiOAuthGrantManager,
  createMemoryOAuthGrantStore,
  createOAuthTokenProvider,
  AomiOAuthError,
} from "./authorization";
export type {
  AomiAuthorizationChallenge,
  AomiAuthorizationPermit,
  AomiAuthorizationState,
  AomiEnsureBoundResult,
  AuthorizationPoster,
  AomiOAuthResource,
  AomiOAuthGrant,
  AomiOAuthGrantManager,
  AomiOAuthGrantStore,
  AomiOAuthTokenProvider,
  AomiOAuthTokenRequest,
  AomiOAuthTokenSet,
} from "./authorization";
export {
  acquireAomiBrowserGrant,
  acquireAomiDeviceGrant,
  createAomiBrowserGrantManager,
  createAomiDeviceGrantManager,
  discoverAomiAuthorizationServer,
  refreshAomiOAuthGrant,
  revokeAomiOAuthGrant,
} from "./oauth";
export type {
  AomiAuthorizationServerMetadata,
  AomiBrowserGrantOptions,
  AomiDeviceVerification,
} from "./oauth";
export { createGuestSessionProvider } from "./guest-auth";
export type { GuestSessionProvider } from "./guest-auth";
export {
  AccountCredentialUnavailableError,
  createAccountBearerProvider,
} from "./account-session";

// =============================================================================
// High-level product SDK
// =============================================================================

export { Aomi } from "./sdk/aomi";
export type { AomiOptions } from "./sdk/aomi";
export { oauth } from "./sdk/auth";
export type {
  AomiAuthController,
  AomiAuthLoginOptions,
  AomiAuthMode,
  AomiAuthStatus,
  AomiAuthStrategy,
  AomiAuthTarget,
  AomiBrowserOAuthOptions,
  AomiDeviceOAuthOptions,
  AomiOAuthStrategy,
} from "./sdk/auth";
export { AomiAgent, AgentRun } from "./sdk/agent";
export type {
  AgentRunEventMap,
  AgentRunOptions,
  AgentRunResult,
} from "./sdk/agent";
export { EvmBuild, EvmStaged, SvmBuild, SvmStaged } from "./sdk/build";
export {
  AomiEvmPipeline,
  AomiPipeline,
  AomiPipelineOperationScope,
  AomiPipelineSkillScope,
  AomiSvmPipeline,
} from "./sdk/pipeline";
export type { AomiOperationBuildOptions } from "./sdk/pipeline";
export { buildSiwsMessage } from "./siws";
export type { SiwsChainId, SiwsIntent } from "./siws";
export {
  createEvmPaymentClient,
  handlePaymentChallenges,
  wrapFetchWithPaymentChallenges,
} from "./payment";
export type {
  AccountBearerProviderOptions,
  AccountBearerProvider,
  AccountCredentialProvider,
  AccountSessionExchangeResponse,
  BetterAuthAccountTokenSourceOptions,
  BetterAuthTokenResponse,
} from "./account-session";

// =============================================================================
// Types
// =============================================================================

export type {
  AomiAppDescriptor,
  AomiArtifactStatus,
  AomiPlatformFilter,
  ApplicationId,
  AomiRequestOptions,
  AomiRequestQueryValue,
  AomiClientOptions,
  AomiHttpMethod,
  AomiAccountProfile,
  AomiAccountRecordStatus,
  AomiAuthProvider,
  AomiAuthPurpose,
  AomiChainKind,
  AomiDelegatedAccount,
  AomiOnchainAddress,
  AomiOnchainPolicy,
  AomiOnchainPolicyBinding,
  AomiOnchainPolicyRule,
  AomiOperatingAccount,
  AomiPolicyWindow,
  AomiProviderBinding,
  AomiSigningPolicy,
  AomiUser,
  AomiUserAccount,
  GetAccountBearer,
  AomiWalletFamily,
  AomiClearSecretsResponse,
  AomiAccountResponse,
  AomiByokKeyEntry,
  AomiListByokKeysResponse,
  AomiSaveByokKeyResponse,
  AomiDeleteSecretResponse,
  AomiIngestSecretsResponse,
  AomiListSecretsResponse,
  AomiSecretSlot,
  AomiSimulateFee,
  AomiSimulateResponse,
  Logger,
} from "./types";
export {
  createProviderCredentialAdapter,
  createSiweAccountAuthAdapter,
  AccountChallengeBindingError,
  createSiwsAccountAuthAdapter,
  createAccountSessionProvider,
  type ProviderCredential,
  type SiwsAccountSessionSigner,
  type AccountAuthAdapter,
  type AccountAuthSession,
  type AccountSessionProvider,
  type AccountSessionSigner,
} from "./widget-session";
export { normalizeAppDescriptor, appIdentityKey } from "./app-descriptor";
export { safeEnv } from "./internal/env";
export type { AomiClientType } from "./user-state";

// =============================================================================
// Type Guards
// =============================================================================

export {
  UserState,
  CLIENT_TYPE_TS_CLI,
  CLIENT_TYPE_WEB_UI,
} from "./user-state";
// =============================================================================
// Session (high-level orchestrated client)
// =============================================================================

export { ClientSession as Session, aaModeFromExecutionKind } from "./session";

export type {
  SessionOptions,
  SessionRuntimeOptions,
  SessionSnapshot,
  SendResult,
} from "./session";

// =============================================================================
// Event Utilities
// =============================================================================

export { TypedEventEmitter } from "./event";

// =============================================================================
// Wallet Utilities
// =============================================================================

export {
  normalizeSolanaCluster,
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
  toAAWalletCalls,
  toAAWalletCall,
  parseChainId,
} from "./wallet-utils";
export { walletCapabilities } from "./wallet/capabilities";
export { walletUserState } from "./wallet/user-state";
export type {
  EvmWallet,
  EvmWalletCall,
  SvmWallet,
  Wallets,
  WalletTransactionResult,
} from "./wallet/types";

export type {
  WalletTxPayload,
  WalletTxCallPayload,
  WalletTxAaPreference,
  WalletEip712Payload,
  WalletSolanaSignPayload,
  WalletSolanaSignMessagePayload,
  ViemSignMessageArgs,
  ViemSignTypedDataArgs,
} from "./wallet-utils";

// =============================================================================
// Chains
// =============================================================================

export {
  ALCHEMY_CHAIN_SLUGS,
  CHAIN_NAMES,
  CHAINS_BY_ID,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
  arcTestnet,
  monad,
  monadTestnet,
  megaeth,
  robinhood,
} from "./chains";
export type { ChainInfo } from "./chains";

// =============================================================================
// Wallet Execution (native wallet only — AA executes server-side)
// =============================================================================

export {
  executeWalletCalls,
  partialWalletExecution,
  PartialWalletExecutionError,
  MAX_AUTO_FEE_WEI,
  normalizeSimulatedFee,
  buildFeeAAWalletCall,
  appendFeeCallToPayload,
} from "./aa";

export type {
  AAMode,
  AASponsorship,
  AAWalletCall,
  AACallPayload,
  WalletCapabilities,
  WalletAtomicCapability,
  NativeWalletExecutionPolicy,
  NativeWalletSponsorship,
  SponsorshipPaymasterServiceContext,
  ExecutionResult,
  PartialWalletExecution,
  AtomicBatchArgs,
  ExecuteWalletCallsParams,
  NormalizedSimulatedFee,
} from "./aa";
