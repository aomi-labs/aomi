export { createDefaultWalletAttesters } from "./providers/default-wallet-attesters";

export { validWalletAddress } from "./providers/wallet-attestation";

export {
  ensureAccountSchema,
  deactivateAomiAccount,
  fetchAttestedProviderWallets,
  claimTelegramSessionOwner,
  getAccountResponseForBetterAuthSession,
  getAccountResponseForWidgetSession,
  getOrCreateAomiUserForSiwe,
  getOrCreateAomiUserForSiws,
  getOrCreateAomiUserForBetterAuthSession,
  linkAnonymousCanonicalAccount,
  linkProviderIdentity,
  renameAuthIdentity,
  renameWallet,
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
  type DeactivateAomiAccountResult,
} from "./service/account-service";

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
  DEFAULT_WALLET_LINK_NONCE_MAX_AGE_MS,
  createWalletLinkNonce,
  verifyWalletLinkNonce,
  verifyWalletLinkSignature,
  walletLinkMessageMatches,
  type WalletLinkNoncePayload,
} from "./service/wallet-linking";

export type {
  AttestedWallet,
  AttestedWalletProvider,
  WalletAttestationLogger,
  WalletAttester,
  WalletAttesterRegistry,
} from "./providers/wallet-attestation";
