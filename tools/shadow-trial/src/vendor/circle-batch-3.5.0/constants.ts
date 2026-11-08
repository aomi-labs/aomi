/**
 * EIP-712 domain name for Circle Gateway batched payments.
 * Used in the `extra.name` field of PaymentRequirements to identify Circle batching options.
 */
export const CIRCLE_BATCHING_NAME = 'GatewayWalletBatched';

/**
 * EIP-712 domain version for Circle Gateway batched payments.
 * Used in the `extra.version` field of PaymentRequirements.
 */
export const CIRCLE_BATCHING_VERSION = '1';

/**
 * The payment scheme used for Circle batching (same as standard x402 exact scheme).
 */
export const CIRCLE_BATCHING_SCHEME = 'exact';

/**
 * Minimum authorization validity window required by Gateway batching.
 */
export const GATEWAY_MIN_AUTH_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

/**
 * Extra validity window so authorizations still satisfy Gateway's minimum
 * after client/server clock differences and request latency.
 */
export const GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS = 100;

/**
 * Authorization validity window the SDK should publish and sign with.
 */
export const GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS =
  GATEWAY_MIN_AUTH_VALIDITY_SECONDS + GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS;
