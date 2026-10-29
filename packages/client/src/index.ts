// ======================================================================// Client
// ======================================================================
export { AomiClient, secretNamesFrom } from "./client";
export {
  AccountCreditsTransport,
  AccountTransport,
  MICROUSD_PER_CREDIT,
} from "./account/credits";
export type {
  CreditLedgerEntry,
  CreditLedger,
  AomiFundingEvent,
  AomiFundingResult,
  AomiCreditMethods,
  AomiCreditListOptions,
  CreditBalance,
} from "./account/credits";
export { AccountKeysTransport, AccountPoliciesTransport } from "./account/keys";
export type { AccountKeyScope } from "./account/keys";
export { AomiApiError, apiErrorFields } from "./api-error";
export type { ApiErrorFields } from "./api-error";
export { AomiCreditApiError } from "./account/credits";
export { AgentApiError, AgentTransport } from "./agent/transport";
export type { AgentAppAccessErrorCode } from "./agent/transport";
export { projectConversationEvents } from "./session/conversation";
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
  PipelineApprovalChange,
  PipelineApprovalKind,
  PipelineAssetStandard,
  PipelineBalanceChange,
  PipelineCommitOptions,
  PipelineBuildOrigin,
  PipelineBuildProvenance,
  PipelineExecutionScope,
  PipelineDirectory,
  PipelineDirectoryEntry,
  PipelineDirectoryEntryKind,
  PipelineFeeEstimate,
  PipelineFilesystemResource,
  PipelineGasEstimate,
  PipelineGuardResult,
  PipelineInvokeOptions,
  PipelineMutationOptions,
  PipelineJsonSchema,
  PipelineLog,
  PipelineOperationBuildInput,
  PipelineOperationDescriptor,
  PipelineOperationInvocation,
  PipelineSimulation,
  PipelineSimulationStatus,
  AssembledSvmInstruction,
  SvmAccountMeta,
  SvmAssembledAccountMeta,
  SvmBuildAction,
  SvmCommitResult,
  SvmDirectInput,
  SvmInstruction,
  SvmInstructionBatch,
  SvmPresentedAction,
  SvmSimulatedBuild,
  SvmStageInput,
  SvmStagedAction,
  SvmStagedBuild,
  SvmTransaction,
} from "./pipeline/types";
export type {
  Action,
  AgentMode,
  AgentTarget,
  ActionRequest,
  ActionResult,
  ContextCompactedEvent,
  ContextCompactingEvent,
  ErrorEvent,
  Event,
  EventPage,
  InterruptIntent,
  MessageEvent,
  RespondToActionIntent,
  Session as AgentSession,
  SessionPage,
  StartTurnIntent,
  TaskActivityEvent,
  TaskCompletedEvent,
  TaskPhaseEvent,
  TaskStartedEvent,
  TitleEvent,
  ToolCompleteEvent,
  ToolOutputTrimmedEvent,
  ToolUpdateEvent,
  TurnState,
  TurnStateChangedEvent,
} from "./agent/types";
export {
  ActionHandler,
  requiresSignatureAdmission,
  MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE,
} from "./actions";
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
  apiResource,
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
export {
  createGuestSessionProvider,
  withBrowserSessionTransition,
} from "./guest-auth";
export type { GuestSessionProvider } from "./guest-auth";
export {
  AccountCredentialUnavailableError,
  createAccountBearerProvider,
} from "./account-session";

// ======================================================================// High-level product SDK
// ======================================================================
export { Aomi } from "./sdk/aomi";
export type { AomiOptions } from "./sdk/aomi";
export { bearer, oauth, wallet } from "./sdk/auth";
export type {
  AomiBearerStrategy,
  AomiAuthController,
  AomiAuthLoginOptions,
  AomiAuthMode,
  AomiAuthStatus,
  AomiAuthStrategy,
  AomiAuthTarget,
  AomiBrowserOAuthOptions,
  AomiDeviceOAuthOptions,
  AomiOAuthStrategy,
  AomiWalletSigner,
  AomiWalletStrategy,
} from "./sdk/auth";
export { AomiAgent, AgentRun } from "./sdk/agent";
export {
  AomiCommits,
  Commit,
  CommitHandle,
  CommitSettleError,
} from "./sdk/commits";
export type { CommitKind, CommitSettlement, CommitSigner } from "./sdk/commits";
export { Thread, Turn } from "./sdk/thread";
export type {
  StepDecoder,
  ThreadSummary,
  ToolStep,
  TurnResult,
  ThreadHistory,
  ThreadHistoryTurn,
} from "./sdk/thread";
export {
  AomiAccount,
  AomiAccountApps,
  AomiAccountWallets,
  AomiGuard,
} from "./sdk/account";
export type { AomiAccountStatement } from "./sdk/account";
export { AomiError, isAomiError } from "./api-error";
export {
  COMMIT_REF_ERROR_CODES,
  CommitApprovalForbiddenError,
  CommitExpiredError,
  CommitNotAwaitingApprovalError,
  CommitNotFoundError,
  CommitStaleError,
} from "./commit-ref";
export type {
  CommitRefView,
  SessionApprovalFields,
  ThreadOrigin,
} from "./commit-ref";
export type {
  AgentRunEventMap,
  AgentRunOptions,
  AgentRunResult,
} from "./sdk/agent";
export { Build, EvmBuild, EvmStaged, SvmBuild, SvmStaged } from "./sdk/build";
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

// ======================================================================// Types
// ======================================================================
export type {
  AomiAppDescriptor,
  AomiFeatureCategory,
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
  AomiBindOnchainPolicy,
  AomiChainKind,
  AomiDelegatedAccount,
  AomiOnchainAddress,
  AomiOnchainPolicy,
  AomiOnchainPolicyBinding,
  AomiOnchainPolicyProviderCtx,
  AomiOnchainPolicyRule,
  AomiOperatingAccount,
  AomiPolicyWindow,
  AomiPreparedOnchainPolicy,
  AomiProviderBinding,
  AomiSigningPolicy,
  AomiUser,
  AomiUserAccount,
  GetAccountBearer,
  AomiWalletFamily,
  AomiClearSecretsResponse,
  AomiAccountResponse,
  AomiClearAppSecretsResponse,
  AomiUserAppSecretSlot,
  AomiUserAppSecrets,
  AomiAccountAppMutationResponse,
  AomiDeleteSecretResponse,
  AomiIngestSecretsResponse,
  AomiListSecretsResponse,
  AomiSecretSlot,
  AomiSimulateFee,
  AomiSimulateResponse,
  SimulationCall,
  SimContext,
  SimulationExecution,
  SimStep,
  SimReport,
  SimulationError,
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
export {
  normalizeAppDescriptor,
  appIdentityKey,
  isOfficialAppDescriptor,
} from "./app-descriptor";
export { safeEnv } from "./internal/env";
export type { AomiClientType } from "./user-state";

// ======================================================================// Type Guards
// ======================================================================
export {
  UserState,
  CLIENT_TYPE_TS_CLI,
  CLIENT_TYPE_WEB_UI,
} from "./user-state";
// ======================================================================// Session (high-level orchestrated client)
// ======================================================================
export { ClientSession as Session, aaModeFromExecutionKind } from "./session";

export type {
  SessionOptions,
  SessionRuntimeOptions,
  SessionSnapshot,
  SendOptions,
  SendResult,
} from "./session";

// ======================================================================// Event Utilities
// ======================================================================
export { TypedEventEmitter } from "./event";

// ======================================================================// Wallet Utilities
// ======================================================================
export {
  normalizeSolanaCluster,
  toViemSignMessageArgs,
  toViemSignTypedDataArgs,
  toAAWalletCalls,
  toAAWalletCall,
  parseChainId,
} from "./wallet-utils";
export { shortAddress } from "./short-address";
export { walletCapabilities } from "./wallet/capabilities";
export { normalizeEvmWalletTarget } from "./wallet/target";
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

export { modelLabel } from "./models";

// ======================================================================// Chains
// ======================================================================
export {
  ALCHEMY_CHAIN_SLUGS,
  CHAIN_NAMES,
  CHAINS_BY_ID,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
  arc,
  arcTestnet,
  monad,
  monadTestnet,
  megaeth,
  robinhood,
} from "./chains";
export type { ChainInfo } from "./chains";

// ======================================================================// Wallet Execution (native wallet only — AA executes server-side)
// ======================================================================
export {
  executeWalletCalls,
  extractBatchTransactionHashes,
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
export { summarizeSimulation, SimulationApiError } from "./simulation";
export * from "./commits";
export * from "./mentions";
export * from "./commit-lifecycle";

export {
  TRANSACTION_SAFETY_NAMES,
  TransactionSafetyTransport,
  transactionSafetyPolicy,
} from "./transaction-safety";
export type {
  TransactionSafetyMode,
  TransactionSafetyPolicy,
  TransactionSafetyAssessment,
  TransactionSafetyDecision,
  TransactionSafetyProjection,
} from "./transaction-safety";

export { CallVerificationError, ExpectedCalls } from "./expected-calls";
export type {
  CallMismatch,
  CallVerification,
  CallVerificationField,
  CallVerificationSubject,
  ExpectedCall,
  ExpectedCallsOptions,
  VerifiedCall,
} from "./expected-calls";

export { AccountGraphTransport, AccountGraphApiError } from "./account/graph";
export {
  AomiWalletError,
  WALLET_ERROR_CODES,
  parseWalletRef,
  walletRef,
} from "./account/wallets";
export type {
  AomiAccountWallet,
  AomiAccountWalletKind,
  AomiActiveWallet,
  AomiThreadWallet,
  AomiWalletErrorCode,
} from "./account/wallets";
export type {
  AomiAgentWallet,
  AomiAgentWalletAddress,
  AomiAgentWalletApp,
  AomiAgentWalletAsset,
  AomiAgentWalletBalances,
  AomiAgentWalletConnection,
  AomiAgentWalletCreate,
  AomiAgentWalletNetwork,
  AomiAgentWalletUpdate,
  AomiAgentWalletWithdraw,
  AomiAgentWallets,
} from "./account/agent-wallets";
export { AomiWallets } from "./sdk/wallets";
export type {
  AomiAccountConnection,
  AomiAccountConnections,
  AomiConnectionApp,
  AomiConnectionTelegram,
  AomiConnectionKind,
  AomiConnectionSettings,
  AomiConnectionSettingsUpdate,
  AomiConnectionWallet,
  AomiConnectionWalletsUpdate,
  AomiLane,
} from "./account/connections";
export { LinkError, isLinkCode } from "./account/account-link";
export type {
  AccountLinkProvider,
  LinkBot,
  LinkInFlight,
  LinkMoves,
  LinkPreview,
  LinkResult,
  LinkWalletMove,
  TelegramLinkIdentity,
  TelegramLinkPreview,
  TelegramLinkResult,
} from "./account/account-link";
export type {
  AccountGraphUser,
  AccountGraphLinkedAccount,
  AccountGraphWallet,
  AccountGraphResponse,
  AccountGraphLinkWalletResponse,
  AccountGraphProviderExchangeResponse,
  AccountGraphDeleteResponse,
} from "./account/graph";
export {
  createScopedStorage,
  type ScopedStorage,
  type StorageScope,
} from "./storage";

export { wrapFetchWithPublicApiAuthorization } from "./client";
export { commitCapabilities, isTerminalCommit } from "./commits";
export type { CommitView } from "./commits";
export type {
  AccountMergeOffer,
  AccountNonce,
  ResolvedAccountLink,
} from "./account/graph";

export { buildSiweMessage, buildWalletLinkMessage } from "./siwe";
export type { SiweMessageInput } from "./siwe";
