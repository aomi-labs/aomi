/**
 * Lifecycle hook types for the Circle Gateway batching SDK.
 *
 * These mirror the lifecycle hooks defined in the standard `@x402/core` SDK.
 * See https://docs.x402.org/advanced-concepts/lifecycle-hooks for the full
 * reference. The semantics implemented here match that documentation: hooks
 * receive a read-only context, drive control flow via `abort` / `skip` /
 * `recovered` return values, and a thrown hook is logged but does not break
 * the surrounding payment flow (the next hook still runs).
 */

/**
 * Minimal `PaymentPayload` shape (subset used by hook contexts).
 */
export interface HookPaymentPayload {
  x402Version: number;
  payload: Record<string, unknown>;
  resource?: { url: string; description: string; mimeType: string };
  accepted?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/**
 * Minimal `PaymentRequirements` shape (subset used by hook contexts).
 */
export interface HookPaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/**
 * Minimal `VerifyResponse` shape (subset used by hook contexts).
 */
export interface HookVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

/**
 * Minimal `SettleResponse` shape (subset used by hook contexts).
 */
export interface HookSettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
}

// ============================================================================
// Verify / Settle hook contexts (resource server + facilitator)
// ============================================================================

export interface VerifyContext {
  paymentPayload: HookPaymentPayload;
  requirements: HookPaymentRequirements;
}

export interface VerifyResultContext extends VerifyContext {
  result: HookVerifyResponse;
}

export interface VerifyFailureContext extends VerifyContext {
  error: Error;
}

export interface SettleContext {
  paymentPayload: HookPaymentPayload;
  requirements: HookPaymentRequirements;
}

export interface SettleResultContext extends SettleContext {
  result: HookSettleResponse;
}

export interface SettleFailureContext extends SettleContext {
  error: Error;
}

/**
 * Reason a verified payment never reached settlement. `handler_threw` matches
 * the standard SDK's reason for "the protected handler errored".
 */
export type VerifiedPaymentCancellationReason = 'handler_threw' | 'handler_failed';

export interface VerifiedPaymentCanceledContext extends SettleContext {
  reason: VerifiedPaymentCancellationReason;
  error?: unknown;
  responseStatus?: number;
}

// ============================================================================
// Verify / Settle hook signatures (resource server flavor)
// ============================================================================

export type BeforeVerifyHook = (
  context: VerifyContext,
) => Promise<
  | void
  | { abort: true; reason: string; message?: string }
  | { skip: true; result: HookVerifyResponse }
>;

export type AfterVerifyHook = (context: VerifyResultContext) => Promise<void | {
  skipHandler: true;
  response?: { contentType?: string; body?: unknown };
}>;

export type OnVerifyFailureHook = (
  context: VerifyFailureContext,
) => Promise<void | { recovered: true; result: HookVerifyResponse }>;

export type BeforeSettleHook = (
  context: SettleContext,
) => Promise<
  | void
  | { abort: true; reason: string; message?: string }
  | { skip: true; result: HookSettleResponse }
>;

export type AfterSettleHook = (context: SettleResultContext) => Promise<void>;

export type OnSettleFailureHook = (
  context: SettleFailureContext,
) => Promise<void | { recovered: true; result: HookSettleResponse }>;

export type OnVerifiedPaymentCanceledHook = (
  context: VerifiedPaymentCanceledContext,
) => Promise<void>;

// ============================================================================
// Facilitator hook signatures
// (mirror x402Facilitator: no skip/skipHandler/cancellation, no `message`)
// ============================================================================

export type FacilitatorBeforeVerifyHook = (
  context: VerifyContext,
) => Promise<void | { abort: true; reason: string }>;

export type FacilitatorAfterVerifyHook = (context: VerifyResultContext) => Promise<void>;

export type FacilitatorOnVerifyFailureHook = (
  context: VerifyFailureContext,
) => Promise<void | { recovered: true; result: HookVerifyResponse }>;

export type FacilitatorBeforeSettleHook = (
  context: SettleContext,
) => Promise<void | { abort: true; reason: string }>;

export type FacilitatorAfterSettleHook = (context: SettleResultContext) => Promise<void>;

export type FacilitatorOnSettleFailureHook = (
  context: SettleFailureContext,
) => Promise<void | { recovered: true; result: HookSettleResponse }>;

// ============================================================================
// HTTP resource-server hook (`onProtectedRequest`)
// ============================================================================

/**
 * Minimal HTTP request descriptor passed to `onProtectedRequest`. Mirrors the
 * shape standard x402 uses, but reduced to the bits the gateway middleware
 * actually has access to.
 */
export interface ProtectedRequestContext {
  /** The HTTP method (uppercase, e.g. "GET"). */
  method: string;
  /** The request path (no query string). */
  path: string;
  /** Full URL as advertised in the 402 response (may equal `path`). */
  url: string;
  /**
   * Case-insensitive header lookup. Returns `undefined` for unknown headers.
   */
  getHeader(name: string): string | undefined;
}

export interface ProtectedRouteConfig {
  /** Price string passed to `gateway.require(...)`. */
  price: string;
}

export type ProtectedRequestHook = (
  context: ProtectedRequestContext,
  routeConfig: ProtectedRouteConfig,
) => Promise<void | { grantAccess: true } | { abort: true; reason: string }>;

// ============================================================================
// Client (payment payload creation) hook contexts and signatures
// ============================================================================

/**
 * Minimal `PaymentRequired` shape passed to client hook contexts.
 */
export interface HookPaymentRequired {
  x402Version: number;
  resource?: { url: string; description: string; mimeType: string };
  accepts: HookPaymentRequirements[];
  extensions?: Record<string, unknown>;
  error?: string;
}

export interface PaymentCreationContext {
  paymentRequired: HookPaymentRequired;
  selectedRequirements: HookPaymentRequirements;
}

export interface PaymentCreatedContext extends PaymentCreationContext {
  paymentPayload: HookPaymentPayload;
}

export interface PaymentCreationFailureContext extends PaymentCreationContext {
  error: Error;
}

export interface PaymentResponseContext {
  paymentPayload: HookPaymentPayload;
  requirements: HookPaymentRequirements;
  settleResponse?: HookSettleResponse;
  paymentRequired?: HookPaymentRequired;
  error?: Error;
}

export type BeforePaymentCreationHook = (
  context: PaymentCreationContext,
) => Promise<void | { abort: true; reason: string }>;

export type AfterPaymentCreationHook = (context: PaymentCreatedContext) => Promise<void>;

export type OnPaymentCreationFailureHook = (
  context: PaymentCreationFailureContext,
) => Promise<void | { recovered: true; payload: HookPaymentPayload }>;

export type OnPaymentResponseHook = (
  context: PaymentResponseContext,
) => Promise<void | { recovered: true }>;

// ============================================================================
// Internal helpers (shared between facilitator / middleware / scheme)
// ============================================================================

/**
 * Logs a warning when a hook throws. Mirrors the standard SDK's
 * `warnResourceServerHookFailure` log line so log-grepping continues to work.
 */
export function warnHookFailure(
  component: string,
  phase: string,
  label: string,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[x402] ${component} ${phase} hook threw (${label}): ${detail}`);
}
