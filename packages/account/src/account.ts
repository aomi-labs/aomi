export { createDefaultWalletAttesters } from "./providers/default-wallet-attesters";

export { validWalletAddress } from "./providers/wallet-attestation";

export {
  ensureAccountSchema,
  deactivateAomiAccount,
  fetchAttestedProviderWallets,
  getAccountResponseForBetterAuthSession,
  getAccountResponseForWidgetSession,
  getOrCreateAomiUserForSiwe,
  getOrCreateAomiUserForSiws,
  getOrCreateAomiUserForBetterAuthSession,
  linkAnonymousCanonicalAccount,
  linkProviderIdentity,
  mergeProviderWalletAttestations,
  renameAuthIdentity,
  renameWallet,
  resolveAttestedProviderWallets,
  resolveSignal,
  syncProviderAttestedWallets,
  syncProviderWallets,
  syncBetterAuthWalletsForUser,
  syncSiweWalletsForUser,
  syncSiwsWalletsForUser,
  unlinkAuthIdentity,
  unlinkWallet,
  updateAccountProfile,
  upsertVerifiedWallet,
  type AttestedProviderWallets,
  type DeactivateAomiAccountResult,
} from "./service/account-service";

export {
  mergeAccountWithTicket,
  offerAccountMerge,
  takeMergeSwitchTicket,
  type AccountMergeOffer,
  type AccountMergeResult,
} from "./service/account-merge";

export {
  exchangeProviderForExistingSession,
  createDefaultProviderCredentialVerifiers,
  isVerifiedProviderTokenCredential,
  linkVerifiedProviderCredentialForUser,
  linkVerifiedProviderIdentityForUser,
  providerSessionUserSeed,
  signInWithVerifiedProviderCredential,
  signInWithVerifiedProviderIdentity,
  verifyProviderCredential,
  type ProviderExchangeResult,
} from "./service/provider-exchange";
export {
  attachVerifiedProviderIdentityToUser,
  IdentityConflictError,
  resolveVerifiedProviderIdentity,
  type IdentityResolutionResult,
} from "./service/identity-resolution";
export type {
  ProviderCredentialVerifier,
  ProviderCredentialVerifierRegistry,
  ProviderTokenCredential,
  VerifiedProviderTokenCredential,
  VerifiedProviderCredential,
  VerifiedProviderToken,
  VerifyProviderCredentialOptions,
} from "./providers/account-credentials";

export {
  listAccountConnections,
  revokeOAuthConnection,
  type AccountConnection,
  type AccountConnections,
  type ConnectionKind,
} from "./service/connections";

export {
  WALLET_LINK_NONCE_MAX_AGE_MS,
  consumeWalletLinkNonce,
  issueWalletLinkNonce,
  verifyWalletLinkSignature,
  walletLinkMessageMatches,
  type WalletLinkTarget,
} from "./service/wallet-linking";

export type {
  AttestedWallet,
  AttestedWalletProvider,
  ProviderLoginIdentifier,
  WalletAttestationLogger,
  WalletAttester,
  WalletAttesterRegistry,
} from "./providers/wallet-attestation";
