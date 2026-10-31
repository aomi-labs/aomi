import type { components } from "../generated/agent-v1/types";
import { AomiApiError } from "../api-error";
import { AccountGraphTransport } from "./graph";
import { AccountWalletsTransport } from "./wallets";
import { AccountConnectionsTransport } from "./connections";
import { AccountLinkTransport } from "./account-link";
import { AccountKeysTransport, AccountPoliciesTransport } from "./keys";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";

export const MICROUSD_PER_CREDIT = 10_000;

export type CreditBalance = components["schemas"]["CreditBalance"];
export type CreditLedger = components["schemas"]["CreditLedger"];
export type CreditLedgerEntry = CreditLedger["entries"][number];

export class AomiCreditApiError extends AomiApiError {
  override name = "AomiCreditApiError";

  constructor(status: number, operation: string, detail?: string) {
    super(
      status,
      "credit_request_failed",
      `Failed to ${operation}: HTTP ${status}${detail ? `\n${detail}` : ""}`,
    );
  }
}

export type AomiCreditListOptions = {
  signal?: AbortSignal;
  limit?: number;
  beforeId?: number;
};

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

export type AomiFundingEvent = {
  id: string;
  idempotency_key: string;
  created_at: number;
  amount_microusd: number;
  method: "card" | "wallet";
  environment: "test" | "production";
  status: "awaiting_action" | "processing" | "credited" | "failed" | "canceled";
  terms: { network?: string; asset?: string; recipient?: string };
  provider_reference: string | null;
  error_code: string | null;
};
export type AomiFundingResult = {
  funding_event: AomiFundingEvent;
  action:
    | { kind: "confirm_card"; client_secret: string }
    | { kind: "wait" | "done" };
};
export type AomiCreditMethods = {
  card: {
    public_key: string;
    min_microusd: number;
    max_microusd: number;
  } | null;
  wallet: {
    min_microusd: number;
    max_microusd: number;
    networks: Array<{
      network: string;
      name: string;
      asset: string;
      recipient: string;
      confirmations: number;
    }>;
  };
};

export class AccountCreditsTransport {
  constructor(
    private readonly requestResponse: RequestResponse,
    private readonly basePath = "/v1/account/credits",
  ) {}

  async methods(): Promise<AomiCreditMethods> {
    return responseJson(
      await this.requestResponse("GET", `${this.basePath}/methods`, {
        raw: true,
      }),
      "load payment methods",
    );
  }
  async fundingEvent(id: string): Promise<AomiFundingResult> {
    return responseJson(
      await this.requestResponse(
        "GET",
        `${this.basePath}/funding-events/${encodeURIComponent(id)}`,
        { raw: true },
      ),
      "check payment",
    );
  }
  async beginFunding(input: {
    amountMicrousd: number;
    method: "card" | "wallet";
    chain?: string;
    idempotencyKey: string;
    x402?: AomiRequestOptions["x402"];
  }): Promise<AomiFundingResult> {
    const response = await this.requestResponse(
      "POST",
      `${this.basePath}/funding-events`,
      {
        raw: input.method === "card",
        x402: input.method === "wallet" ? input.x402 : undefined,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "X-Aomi-CSRF": "1",
        },
        body: {
          amount_microusd: input.amountMicrousd,
          method: input.method,
          ...(input.chain ? { chain: input.chain } : {}),
        },
      },
    );
    return responseJson(response, "start payment");
  }
  async cancelFunding(id: string): Promise<AomiFundingResult> {
    return responseJson(
      await this.requestResponse(
        "POST",
        `${this.basePath}/funding-events/${encodeURIComponent(id)}/cancel`,
        {
          raw: true,
          headers: { "X-Aomi-CSRF": "1" },
        },
      ),
      "cancel payment",
    );
  }

  async get(options: { signal?: AbortSignal } = {}): Promise<CreditBalance> {
    return responseJson(
      await this.requestResponse("GET", this.basePath, options),
      "load balance",
    );
  }

  async ledger(options: AomiCreditListOptions = {}): Promise<CreditLedger> {
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Credit activity limit must be between 1 and 100");
    }
    if (
      options.beforeId !== undefined &&
      (!Number.isInteger(options.beforeId) || options.beforeId < 1)
    ) {
      throw new RangeError("Credit activity cursor must be a positive integer");
    }
    return responseJson(
      await this.requestResponse("GET", `${this.basePath}/ledger`, {
        query: { limit, before_id: options.beforeId },
        signal: options.signal,
      }),
      "load credit ledger",
    );
  }
}

export class AccountTransport extends AccountGraphTransport {
  readonly credits: AccountCreditsTransport;
  /** The wallet list, agent wallets, balances and the thread switch. */
  readonly wallets: AccountWalletsTransport;
  /** Connected OAuth clients and Telegram (portal sessions only). */
  readonly connections: AccountConnectionsTransport;
  /** Link a platform account with a one-time code (portal sessions only). */
  readonly link: AccountLinkTransport;
  /** The secrets vault: BYOK provider keys and values tools use by handle. */
  readonly keys: AccountKeysTransport;
  /** On-chain spending policies. */
  readonly policies: AccountPoliciesTransport;
  constructor(requestResponse: RequestResponse) {
    super(requestResponse);
    const request = <T>(path: string, init: RequestInit) =>
      this.request<T>(path, init);
    this.keys = new AccountKeysTransport(request);
    this.policies = new AccountPoliciesTransport(request);
    this.credits = new AccountCreditsTransport(requestResponse);
    this.wallets = new AccountWalletsTransport(requestResponse);
    this.connections = new AccountConnectionsTransport(requestResponse);
    this.link = new AccountLinkTransport(requestResponse);
  }
}

async function responseJson<T>(
  response: Response,
  operation: string,
): Promise<T> {
  if (!response.ok) {
    const detail = await responseErrorDetail(response);
    throw new AomiCreditApiError(response.status, operation, detail);
  }
  return (await response.json()) as T;
}

async function responseErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) return undefined;

  try {
    const payload = JSON.parse(body) as unknown;
    const detail = jsonErrorDetail(payload);
    return detail ? detail.slice(0, 500) : undefined;
  } catch {
    // Gateways and proxies sometimes return an HTML error page. Keep the
    // status in the API error while hiding that page from users.
    return undefined;
  }
}

function jsonErrorDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["message", "detail", "error"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      const nested = jsonErrorDetail(candidate);
      if (nested) return nested;
    }
  }
  return undefined;
}
