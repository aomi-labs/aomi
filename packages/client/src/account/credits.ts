import type { AomiHttpMethod, AomiRequestOptions } from "../types";

export const MICROUSD_PER_CREDIT = 10_000;
export const MIN_CREDIT_TOP_UP = 1;
export const MAX_CREDIT_TOP_UP = 100_000;

export type AomiCreditActivity = {
  id: number;
  amount_microusd: number;
  entry_kind: "purchase" | "usage_debit";
  payment_method: string | null;
  payment_provider: string | null;
  external_payment_reference: string | null;
  application_id: number | null;
  metadata: Record<string, unknown>;
  created_at: number;
};

export type AomiCreditPosition = {
  period_utc_month: string;
  included: {
    limit_microusd: number;
    used_microusd: number;
    remaining_microusd: number;
  };
  bank: {
    balance_microusd: number;
    outstanding_debt_microusd: number;
  };
  entries: AomiCreditActivity[];
  next_before_id: number | null;
};

export type AomiCreditPaymentReceipt = {
  transaction?: string;
  network?: string;
};

export type AomiCreditTopUpResult = AomiCreditPosition & {
  receipt?: AomiCreditPaymentReceipt;
};

export class AomiCreditApiError extends Error {
  constructor(
    readonly status: number,
    operation: string,
    detail?: string,
  ) {
    super(
      `Failed to ${operation}: HTTP ${status}${detail ? `\n${detail}` : ""}`,
    );
    this.name = "AomiCreditApiError";
  }
}

export type AomiCreditListOptions = {
  limit?: number;
  beforeId?: number;
};

export type AomiCreditTopUpOptions =
  | {
      credits: number;
      amountMicrousd?: never;
      idempotencyKey: string;
      /** Retry a previously submitted payment without creating a new proof. */
      recover?: boolean;
    }
  | {
      amountMicrousd: number;
      credits?: never;
      idempotencyKey: string;
      /** Retry a previously submitted payment without creating a new proof. */
      recover?: boolean;
    };

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

export class AccountCreditsTransport {
  constructor(
    private readonly requestResponse: RequestResponse,
    private readonly basePath = "/v1/account/credits",
  ) {}

  async get(options: AomiCreditListOptions = {}): Promise<AomiCreditPosition> {
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
    const response = await this.requestResponse("GET", this.basePath, {
      query: { limit, before_id: options.beforeId },
    });
    return parseAomiCreditPosition(
      await responseJson<unknown>(response, "fetch account credits"),
    );
  }

  async topUp(options: AomiCreditTopUpOptions): Promise<AomiCreditTopUpResult> {
    const amountMicrousd = topUpMicrousd(options);
    const idempotencyKey = options.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new TypeError("Credit top-up requires an idempotency key");
    }
    if (idempotencyKey.length > 200) {
      throw new RangeError("Credit top-up idempotency key is too long");
    }
    const response = await this.requestResponse(
      "POST",
      `${this.basePath}/top-up`,
      {
        // A recovery probe must reach the backend without the x402 wrapper:
        // the original proof is already bound to this idempotency key and a
        // fresh challenge would be rejected as a different payment attempt.
        raw: options.recover === true,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Aomi-CSRF": "1",
        },
        body: { amount_microusd: amountMicrousd },
      },
    );
    const result = parseAomiCreditPosition(
      await responseJson<unknown>(response, "top up account credits"),
    );
    const receipt = paymentReceiptFrom(response);
    return receipt ? { ...result, receipt } : result;
  }
}

/**
 * Normalize account-credit responses across the payment-service cutover.
 *
 * The public client model remains nested so existing consumers do not need to
 * migrate in lockstep with the backend's flat `UserCredits` wire contract.
 */
export function parseAomiCreditPosition(value: unknown): AomiCreditPosition {
  const position = objectValue(value, "account credits");
  const legacyIncluded = optionalObject(position.included);
  const legacyBank = optionalObject(position.bank);
  const records = position.records ?? position.entries;
  if (!Array.isArray(records)) {
    throw invalidCreditResponse("records must be an array");
  }

  return {
    period_utc_month: stringValue(
      position.period_utc_month,
      "period_utc_month",
    ),
    included: {
      limit_microusd: numberValue(
        position.included_limit ?? legacyIncluded?.limit_microusd,
        "included_limit",
      ),
      used_microusd: numberValue(
        position.included_used ?? legacyIncluded?.used_microusd,
        "included_used",
      ),
      remaining_microusd: numberValue(
        position.included_remaining ?? legacyIncluded?.remaining_microusd,
        "included_remaining",
      ),
    },
    bank: {
      balance_microusd: numberValue(
        position.balance ?? legacyBank?.balance_microusd,
        "balance",
      ),
      outstanding_debt_microusd: numberValue(
        position.outstanding_debt ?? legacyBank?.outstanding_debt_microusd,
        "outstanding_debt",
      ),
    },
    entries: records.map(parseCreditActivity),
    next_before_id: nullableNumberValue(
      position.next_before_id,
      "next_before_id",
    ),
  };
}

function parseCreditActivity(value: unknown): AomiCreditActivity {
  const record = objectValue(value, "credit record");
  const kind = stringValue(record.kind ?? record.entry_kind, "record.kind");
  if (kind !== "purchase" && kind !== "usage_debit") {
    throw invalidCreditResponse(`unsupported record kind: ${kind}`);
  }
  return {
    id: numberValue(record.id, "record.id"),
    amount_microusd: numberValue(
      record.amount ?? record.amount_microusd,
      "record.amount",
    ),
    entry_kind: kind,
    payment_method: nullableStringValue(
      record.payment_method,
      "record.payment_method",
    ),
    payment_provider: nullableStringValue(
      record.payment_provider,
      "record.payment_provider",
    ),
    external_payment_reference: nullableStringValue(
      record.external_payment_reference,
      "record.external_payment_reference",
    ),
    application_id: nullableNumberValue(
      record.application_id,
      "record.application_id",
    ),
    metadata: optionalObject(record.metadata) ?? {},
    created_at: numberValue(record.created_at, "record.created_at"),
  };
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  const object = optionalObject(value);
  if (!object) throw invalidCreditResponse(`${field} must be an object`);
  return object;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw invalidCreditResponse(`${field} must be a string`);
  }
  return value;
}

function nullableStringValue(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, field);
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalidCreditResponse(`${field} must be a safe integer`);
  }
  return value;
}

function nullableNumberValue(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return numberValue(value, field);
}

function invalidCreditResponse(detail: string): TypeError {
  return new TypeError(`Invalid account credits response: ${detail}`);
}

export class AccountTransport {
  readonly credits: AccountCreditsTransport;
  constructor(requestResponse: RequestResponse) {
    this.credits = new AccountCreditsTransport(requestResponse);
  }
}

function topUpMicrousd(options: AomiCreditTopUpOptions): number {
  const scaled =
    options.credits === undefined
      ? options.amountMicrousd
      : options.credits * MICROUSD_PER_CREDIT;
  if (!Number.isSafeInteger(scaled)) {
    throw new TypeError(
      "Credit top-up must resolve to a whole, safe microusd amount",
    );
  }
  const min = MIN_CREDIT_TOP_UP * MICROUSD_PER_CREDIT;
  const max = MAX_CREDIT_TOP_UP * MICROUSD_PER_CREDIT;
  if (scaled < min || scaled > max) {
    throw new RangeError(
      `Credit top-up must be between ${MIN_CREDIT_TOP_UP.toLocaleString()} and ${MAX_CREDIT_TOP_UP.toLocaleString()} credits`,
    );
  }
  return scaled;
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

function paymentReceiptFrom(
  response: Response,
): AomiCreditPaymentReceipt | undefined {
  const header =
    response.headers.get("payment-response") ??
    response.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(
      atob(
        normalized.padEnd(
          normalized.length + ((4 - (normalized.length % 4)) % 4),
          "=",
        ),
      ),
    ) as Record<string, unknown>;
    const transaction =
      typeof parsed.transaction === "string" ? parsed.transaction : undefined;
    const network =
      typeof parsed.network === "string" ? parsed.network : undefined;
    return transaction || network ? { transaction, network } : undefined;
  } catch {
    return undefined;
  }
}
