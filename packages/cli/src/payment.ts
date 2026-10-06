import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

import { wrapFetchWithPaymentChallenges } from "../payment";
import type { CliConfig } from "./types";
import { fatal } from "./errors";

export type CliPaymentRequirement = {
  amount?: string;
  asset?: string;
  network?: string;
  payTo?: string;
  error?: string;
};

export type CliPaymentEvent =
  | {
      type: "required";
      url: string;
      requirement?: CliPaymentRequirement;
    }
  | { type: "submitting"; url: string }
  | {
      type: "settled";
      url: string;
      status: number;
      receiptId?: string;
    }
  | {
      type: "rejected";
      url: string;
      status: number;
      reason?: string;
    };

export type CliPaymentListener = (event: CliPaymentEvent) => void;

type PaymentRequiredWire = {
  error?: unknown;
  accepts?: Array<{
    amount?: unknown;
    asset?: unknown;
    network?: unknown;
    payTo?: unknown;
  }>;
};

type PaymentResponseWire = {
  transaction?: unknown;
  network?: unknown;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseBase64Json<T>(value: string): T | undefined {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    return JSON.parse(atob(padded)) as T;
  } catch {
    return undefined;
  }
}

async function paymentRequirementFrom(
  response: Response,
): Promise<CliPaymentRequirement | undefined> {
  const fromHeader = response.headers.get("Payment-Required");
  const payload = fromHeader
    ? parseBase64Json<PaymentRequiredWire>(fromHeader)
    : await response
        .clone()
        .json()
        .catch(() => undefined as PaymentRequiredWire | undefined);
  const accepted = payload?.accepts?.[0];
  if (!accepted) return undefined;

  return {
    amount: stringValue(accepted.amount),
    asset: stringValue(accepted.asset),
    network: stringValue(accepted.network),
    payTo: stringValue(accepted.payTo),
    error: stringValue(payload?.error),
  };
}

function receiptIdFrom(response: Response): string | undefined {
  const receipt = response.headers.get("Payment-Receipt");
  if (receipt) return receipt;
  const header = paymentResponseHeader(response);
  const settlement = header
    ? parseBase64Json<PaymentResponseWire>(header)
    : undefined;
  return (
    stringValue(settlement?.transaction) ?? stringValue(settlement?.network)
  );
}

function paymentResponseHeader(response: Response): string | null {
  return (
    response.headers.get("Payment-Response") ??
    response.headers.get("X-Payment-Response")
  );
}

function hasPaymentSignature(request: Request): boolean {
  return (
    request.headers.has("Payment-Signature") || request.headers.has("X-Payment")
  );
}

function createTracedFetch(
  fetchImpl: typeof fetch,
  onPayment?: CliPaymentListener,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const isPaymentRetry = hasPaymentSignature(request);
    if (isPaymentRetry) {
      onPayment?.({ type: "submitting", url: request.url });
    }
    const response = await fetchImpl(request);

    if (!onPayment) return response;

    if (isPaymentRetry) {
      const settled = response.ok || paymentResponseHeader(response) !== null;
      onPayment(
        settled
          ? {
              type: "settled",
              url: request.url,
              status: response.status,
              receiptId: receiptIdFrom(response),
            }
          : {
              type: "rejected",
              url: request.url,
              status: response.status,
              reason: (await paymentRequirementFrom(response))?.error,
            },
      );
    } else if (response.status === 402) {
      onPayment({
        type: "required",
        url: request.url,
        requirement: await paymentRequirementFrom(response),
      });
    }

    return response;
  };
}

export function createCliPaymentFetch(
  config?: Partial<CliConfig>,
  onPayment?: CliPaymentListener,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch | undefined {
  if (!config?.paymentMethod) {
    return undefined;
  }

  if (config.paymentMethod !== "coinbase") {
    fatal("Unsupported payment method. Use `coinbase`.");
  }

  if (!config.privateKey) {
    fatal(
      "`--payment-method coinbase` requires an EVM private key. Pass `--private-key` or set `PRIVATE_KEY`.",
    );
  }

  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const paymentClient = new x402Client();
  paymentClient.register("eip155:*", new ExactEvmScheme(account as never));

  return wrapFetchWithPaymentChallenges(
    createTracedFetch(fetchImpl, onPayment),
    paymentClient,
  );
}
