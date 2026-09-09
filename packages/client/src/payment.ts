import type { x402Client, x402HTTPClient } from "@x402/core/client";
import { x402Client as X402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { getAddress, isAddress } from "viem";
import type { EvmWallet } from "./wallet/types";

const MAX_PAYMENT_CHALLENGES = 4;

/** Build the canonical x402 signer from the EVM wallet already given to Aomi. */
export function createEvmPaymentClient(
  wallet: EvmWallet,
): x402Client | undefined {
  if (!isAddress(wallet.address) || !wallet.signTypedData) return undefined;
  const client = new X402Client();
  client.register(
    "eip155:*",
    new ExactEvmScheme({
      address: getAddress(wallet.address) as `0x${string}`,
      signTypedData: async (typedData) => {
        const result = await wallet.signTypedData!({
          typedData: typedData as Record<string, unknown>,
        });
        return (
          typeof result === "string" ? result : result.signature
        ) as `0x${string}`;
      },
    }),
  );
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const chainId = paymentChainId(selectedRequirements.network);
    const currentChainId =
      typeof wallet.chainId === "function" ? wallet.chainId() : wallet.chainId;
    if (currentChainId === chainId) return;
    if (!wallet.switchChain) {
      throw new Error(`EVM wallet cannot switch to x402 chain ${chainId}`);
    }
    await wallet.switchChain(chainId);
  });
  return client;
}

function paymentChainId(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  const chainId = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new Error(`Unsupported x402 EVM network: ${network}`);
  }
  return chainId;
}

function paymentResponseHeader(response: Response): string | null {
  return (
    response.headers.get("payment-response") ??
    response.headers.get("x-payment-response")
  );
}

function withInitialResponse(
  initialResponse: Response,
  fetchImpl: typeof globalThis.fetch,
): typeof globalThis.fetch {
  let pendingResponse: Response | undefined = initialResponse;

  return (input, init) => {
    if (pendingResponse) {
      const response = pendingResponse;
      pendingResponse = undefined;
      return Promise.resolve(response);
    }
    return fetchImpl(input, init);
  };
}

/**
 * Pays an x402 challenge and follows a new challenge only when the preceding
 * signed response includes a settlement receipt.
 */
export async function handlePaymentChallenges(
  request: Request,
  initialResponse: Response,
  fetchImpl: typeof globalThis.fetch,
  client: x402Client | x402HTTPClient,
): Promise<Response> {
  let response = initialResponse;
  let attempts = 0;

  while (response.status === 402) {
    if (attempts > 0 && paymentResponseHeader(response) === null) {
      return response;
    }
    if (attempts === MAX_PAYMENT_CHALLENGES) {
      return response;
    }

    response = await wrapFetchWithPayment(
      withInitialResponse(response, fetchImpl),
      client,
    )(request.clone());
    attempts += 1;
  }

  return response;
}

/** Adds bounded sequential x402 settlement to a fetch implementation. */
export function wrapFetchWithPaymentChallenges(
  fetchImpl: typeof globalThis.fetch,
  client: x402Client | x402HTTPClient,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await fetchImpl(request.clone());
    return handlePaymentChallenges(request, response, fetchImpl, client);
  };
}
