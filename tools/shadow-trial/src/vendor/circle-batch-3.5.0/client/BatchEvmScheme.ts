import type { Address, Hex } from 'viem';
import { getAddress } from 'viem';
import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  CIRCLE_BATCHING_SCHEME,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from '../constants';
import { supportsBatching, getVerifyingContract } from '../detection';
import type { BatchEvmSigner, BatchPayload } from '../types';
import {
  warnHookFailure,
  type BeforePaymentCreationHook,
  type AfterPaymentCreationHook,
  type OnPaymentCreationFailureHook,
  type OnPaymentResponseHook,
  type PaymentCreationContext,
  type PaymentCreatedContext,
  type PaymentCreationFailureContext,
  type PaymentResponseContext,
  type HookPaymentRequired,
  type HookPaymentRequirements,
  type HookPaymentPayload,
} from '../hooks';

/**
 * EIP-712 types for TransferWithAuthorization.
 */
const authorizationTypes: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Generate a random 32-byte nonce for EIP-3009.
 */
function createNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

/**
 * PaymentRequirements interface (minimal subset needed).
 */
interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/**
 * PaymentPayload interface (minimal subset needed).
 */
interface PaymentPayload {
  x402Version: number;
  payload: BatchPayload;
}

/**
 * SchemeNetworkClient interface from @x402/core.
 */
interface SchemeNetworkClient {
  readonly scheme: string;
  createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>>;
}

/**
 * Circle Batching EVM Scheme Client.
 *
 * A SchemeNetworkClient implementation for Circle Gateway batched payments.
 * Signs EIP-3009 TransferWithAuthorization against the GatewayWallet contract
 * (from `extra.verifyingContract`) instead of the USDC token contract.
 *
 * Lifecycle hooks (`onBeforePaymentCreation`, `onAfterPaymentCreation`,
 * `onPaymentCreationFailure`, `onPaymentResponse`) mirror the standard SDK's
 * `x402Client` semantics — see https://docs.x402.org/advanced-concepts/lifecycle-hooks.
 *
 * Hooks fire inside `createPaymentPayload` so that this scheme can be used
 * standalone (without `x402Client`). When wrapped by an `x402Client`, register
 * hooks at that level instead — running them in both places would double-fire.
 *
 * @example
 * ```typescript
 * import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
 *
 * const scheme = new BatchEvmScheme(evmSigner)
 *   .onBeforePaymentCreation(async (ctx) => {
 *     if (BigInt(ctx.selectedRequirements.amount) > 10_000_000n) {
 *       return { abort: true, reason: "Payment exceeds spending limit" };
 *     }
 *   })
 *   .onAfterPaymentCreation(async (ctx) => {
 *     console.log("Signed payment", ctx.paymentPayload);
 *   });
 * ```
 */
export class BatchEvmScheme implements SchemeNetworkClient {
  readonly scheme = CIRCLE_BATCHING_SCHEME;

  private beforePaymentCreationHooks: BeforePaymentCreationHook[] = [];
  private afterPaymentCreationHooks: AfterPaymentCreationHook[] = [];
  private onPaymentCreationFailureHooks: OnPaymentCreationFailureHook[] = [];
  private paymentResponseHooks: OnPaymentResponseHook[] = [];

  /**
   * Creates a new BatchEvmScheme.
   *
   * @param signer - The EVM signer for signing payment authorizations
   */
  constructor(private readonly signer: BatchEvmSigner) {}

  /**
   * Register a hook that runs before payment payload creation. Returning
   * `{ abort: true, reason }` causes `createPaymentPayload` to throw
   * `Error("Payment creation aborted: <reason>")`.
   */
  onBeforePaymentCreation(hook: BeforePaymentCreationHook): this {
    this.beforePaymentCreationHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs after a successful payment payload creation.
   */
  onAfterPaymentCreation(hook: AfterPaymentCreationHook): this {
    this.afterPaymentCreationHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs when payload creation throws. Return
   * `{ recovered: true, payload }` to swallow the error and use the
   * provided payload as the result instead.
   */
  onPaymentCreationFailure(hook: OnPaymentCreationFailureHook): this {
    this.onPaymentCreationFailureHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs after the buyer's paid HTTP request completes.
   * Hooks fire when {@link dispatchPaymentResponse} is called by the
   * transport. Return `{ recovered: true }` to instruct the transport to
   * retry with a fresh payload.
   */
  onPaymentResponse(hook: OnPaymentResponseHook): this {
    this.paymentResponseHooks.push(hook);
    return this;
  }

  /**
   * Fire all registered `onPaymentResponse` hooks in order. Returns
   * `{ recovered: true }` if any hook signals recovery (first wins).
   *
   * Transport wrappers should call this after the paid HTTP request settles
   * — see `x402HTTPClient.processPaymentResult` in the standard SDK.
   */
  async dispatchPaymentResponse(
    context: PaymentResponseContext,
  ): Promise<{ recovered: true } | undefined> {
    for (const [index, hook] of this.paymentResponseHooks.entries()) {
      try {
        const result = await hook(context);
        if (result && 'recovered' in result && result.recovered) {
          return { recovered: true };
        }
      } catch (err) {
        warnHookFailure(
          'BatchEvmScheme',
          'onPaymentResponse',
          `manual hook #${index}`,
          err,
        );
      }
    }
    return undefined;
  }

  /**
   * Creates a payment payload for Circle batching.
   *
   * @param x402Version - The x402 protocol version
   * @param paymentRequirements - The payment requirements (must be a Circle batching option)
   * @returns Promise resolving to the payment payload
   * @throws Error if requirements are not a Circle batching option
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    // Build the hook context once.
    const context: PaymentCreationContext = {
      paymentRequired: this.synthesizePaymentRequired(x402Version, paymentRequirements),
      selectedRequirements: paymentRequirements as HookPaymentRequirements,
    };

    // beforePaymentCreation: any hook may abort.
    for (const hook of this.beforePaymentCreationHooks) {
      const result = await hook(context);
      if (result && 'abort' in result && result.abort) {
        throw new Error(`Payment creation aborted: ${result.reason}`);
      }
    }

    try {
      // Validate this is a Circle batching option
      if (!supportsBatching(paymentRequirements)) {
        throw new Error(
          `BatchEvmScheme can only handle Circle batching options. ` +
            `Expected extra.name="${CIRCLE_BATCHING_NAME}" and extra.version="${CIRCLE_BATCHING_VERSION}"`,
        );
      }

      const verifyingContract = getVerifyingContract(paymentRequirements);
      if (!verifyingContract) {
        throw new Error(
          'Circle batching option missing extra.verifyingContract (GatewayWallet address)',
        );
      }

      const nonce = createNonce();
      const now = Math.floor(Date.now() / 1000);
      const validityWindowSeconds = Math.max(
        paymentRequirements.maxTimeoutSeconds,
        GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
      );

      const authorization: BatchPayload['authorization'] = {
        from: this.signer.address,
        to: getAddress(paymentRequirements.payTo) as Address,
        value: paymentRequirements.amount,
        validAfter: (now - 600).toString(), // 10 minutes before
        // Clamp seller-published timeouts so the signed authorization is always
        // valid long enough for Gateway batching.
        validBefore: (now + validityWindowSeconds).toString(),
        nonce,
      };

      // Sign against GatewayWallet contract (not USDC)
      const signature = await this.signAuthorization(
        authorization,
        paymentRequirements,
        verifyingContract,
      );

      const payload: BatchPayload = {
        authorization,
        signature,
      };

      const partial = {
        x402Version,
        payload,
      };

      // afterPaymentCreation: synthesize a "wrapped" PaymentPayload to match
      // the shape the standard SDK passes to its hooks.
      const created: HookPaymentPayload = {
        x402Version,
        payload: payload as unknown as Record<string, unknown>,
      };
      const createdContext: PaymentCreatedContext = {
        ...context,
        paymentPayload: created,
      };
      for (const [index, hook] of this.afterPaymentCreationHooks.entries()) {
        try {
          await hook(createdContext);
        } catch (err) {
          warnHookFailure(
            'BatchEvmScheme',
            'afterPaymentCreation',
            `manual hook #${index}`,
            err,
          );
        }
      }

      return partial;
    } catch (error) {
      const failureContext: PaymentCreationFailureContext = {
        ...context,
        error: error as Error,
      };
      for (const hook of this.onPaymentCreationFailureHooks) {
        const result = await hook(failureContext);
        if (result && 'recovered' in result && result.recovered) {
          return {
            x402Version: result.payload.x402Version,
            payload: result.payload.payload as unknown as BatchPayload,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Sign the EIP-3009 authorization using EIP-712.
   * Uses the GatewayWallet contract as verifyingContract instead of USDC.
   */
  private async signAuthorization(
    authorization: BatchPayload['authorization'],
    requirements: PaymentRequirements,
    verifyingContract: string,
  ): Promise<Hex> {
    if (!requirements.network.startsWith('eip155:')) {
      throw new Error(
        `BatchEvmScheme: unsupported network format "${requirements.network}". Expected "eip155:<chainId>"`,
      );
    }
    const chainId = parseInt(requirements.network.split(':')[1]);

    const domain = {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      chainId,
      verifyingContract: getAddress(verifyingContract) as Address,
    };

    const message = {
      from: getAddress(authorization.from),
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    };

    return await this.signer.signTypedData({
      domain,
      types: authorizationTypes,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  }

  /**
   * When `createPaymentPayload` is called directly (not through an x402Client),
   * we don't have a real PaymentRequired response. Synthesize a minimal one
   * so the hook context still carries the standard SDK's shape.
   */
  private synthesizePaymentRequired(
    x402Version: number,
    requirements: PaymentRequirements,
  ): HookPaymentRequired {
    return {
      x402Version,
      accepts: [requirements as HookPaymentRequirements],
    };
  }
}
