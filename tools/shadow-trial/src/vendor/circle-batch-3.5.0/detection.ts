import { CIRCLE_BATCHING_NAME, CIRCLE_BATCHING_VERSION } from './constants';

/**
 * PaymentRequirements-like structure for detection.
 * We only need the `extra` field to detect batching options.
 */
interface PaymentRequirementsLike {
  extra?: Record<string, unknown>;
}

/**
 * Check if a PaymentRequirements object supports batched settlement.
 *
 * Batching options are identified by:
 * - `extra.name === "GatewayWalletBatched"`
 * - `extra.version === "1"`
 *
 * @param requirements - The payment requirements to check
 * @returns true if this supports batched settlement
 *
 * @example
 * ```typescript
 * import { supportsBatching } from "@circle-fin/x402-batching";
 *
 * if (supportsBatching(paymentRequirements)) {
 *   // This option uses batched settlement (gas-free for users!)
 * }
 * ```
 */
export function supportsBatching(requirements: PaymentRequirementsLike): boolean {
  const extra = requirements.extra;
  if (!extra) {
    return false;
  }

  return extra.name === CIRCLE_BATCHING_NAME && extra.version === CIRCLE_BATCHING_VERSION;
}

/**
 * Check if a PaymentRequirements object is a batched payment.
 *
 * This is an alias for `supportsBatching`, intended for server-side/facilitator use.
 * Use this to route payments to the appropriate handler.
 *
 * @param requirements - The payment requirements to check
 * @returns true if this is a batched payment
 *
 * @example
 * ```typescript
 * import { isBatchPayment, BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
 *
 * const gateway = new BatchFacilitatorClient();
 *
 * // In your facilitator's verify/settle handler:
 * if (isBatchPayment(requirements)) {
 *   return gateway.verify(payload, requirements);
 * }
 * // else: handle with existing on-chain logic
 * ```
 */
export const isBatchPayment = supportsBatching;

/**
 * Get the verifyingContract address from batching requirements.
 *
 * @param requirements - The payment requirements
 * @returns The batch wallet contract address, or undefined if not a batching option
 */
export function getVerifyingContract(
  requirements: PaymentRequirementsLike,
): string | undefined {
  if (!supportsBatching(requirements)) {
    return undefined;
  }

  const verifyingContract = requirements.extra?.verifyingContract;
  if (typeof verifyingContract === 'string') {
    return verifyingContract;
  }

  return undefined;
}
