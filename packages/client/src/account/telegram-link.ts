/**
 * Link a Telegram account to the signed-in portal account (Agent Wallets v1,
 * step 5). `/link` in an Aomi app bot mints a one-time code; the portal page
 * `/link/telegram?code=…` previews what moves and confirms the link.
 *
 * HAND-WRITTEN WIRE TYPES, matching notes/step5-contract.md §3.6. The routes
 * are portal-session only (the BFF refuses every other credential), so they
 * are not part of the generated agent API and not exposed on `Aomi`:
 *   - `POST /v1/account/link/telegram/preview` -> `TelegramLinkPreview`
 *   - `POST /v1/account/link/telegram/confirm` -> `TelegramLinkResult`
 *   - `POST /v1/account/link/telegram/cancel`  -> `{ cancelled: true }`
 * Each takes `{ "code": "<43 chars>" }` in the body, never in the URL.
 */
import { AomiApiError } from "../api-error";
import { asRecord, stringValue } from "../internal/record";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";

/** A `/link` code: 32 random bytes, base64url without padding. */
const LINK_CODE = /^[A-Za-z0-9_-]{43}$/;

/** True for a well-formed `/link` code; anything else is never sent. */
export function isTelegramLinkCode(value: unknown): value is string {
  return typeof value === "string" && LINK_CODE.test(value);
}

export const TELEGRAM_LINK_ERROR_CODES = {
  invalidCode: "invalid_code",
  portalSessionRequired: "portal_session_required",
  linkInProgress: "link_in_progress",
  telegramAlreadyLinked: "telegram_already_linked",
  accountHasOtherTelegram: "account_has_other_telegram",
  accountLinkConflict: "account_link_conflict",
  accountMergeInProgress: "account_merge_in_progress",
  accountLinkBusy: "account_link_busy",
  linkCodeInvalid: "link_code_invalid",
  linkCodeExpired: "link_code_expired",
  linkCodeUsed: "link_code_used",
  rateLimited: "rate_limited",
} as const;

export type TelegramLinkErrorCode =
  | (typeof TELEGRAM_LINK_ERROR_CODES)[keyof typeof TELEGRAM_LINK_ERROR_CODES]
  | (string & {});

export type TelegramLinkBot = { bot_id: string; label: string };

/** An agent wallet that moves to this account. */
export type TelegramLinkWalletMove = {
  id: string;
  family: "evm" | "svm";
  /** Short form, e.g. `0x7a3f…c41e`. */
  address: string;
  label: string;
  /** Null when the balance could not be read. */
  total_usd: string | null;
  /** `default` when this account has no agent wallet of that family yet. */
  becomes: "default" | "extra";
};

/** `POST /v1/account/link/telegram/preview`: read-only, does not claim the code. */
export type TelegramLinkPreview = {
  telegram: {
    username: string | null;
    /** The bots this Telegram user chats with. */
    bots: TelegramLinkBot[];
    /** The bot that issued the code. */
    linked_from: TelegramLinkBot | null;
  };
  /** The signed-in account, which survives. */
  account: { label: string };
  survivor: "this_account";
  moves: {
    agent_wallets: TelegramLinkWalletMove[];
    chats_in_bots: number;
    scheduled_jobs: number;
    /** Trades waiting for approval (cancelled) and being sent (waited for). */
    pending_trades: { cancel: number; wait: number };
    world: { bot: string; state: string }[];
  };
  /** Unix seconds. */
  expires_at: number;
};

/** `POST /v1/account/link/telegram/confirm`. A repeat returns the same result. */
export type TelegramLinkResult = {
  linked: true;
  telegram: { username: string | null };
  wallets: {
    id: string;
    address: string;
    role: "default" | "extra";
  }[];
  /** Trades that were waiting for approval and were cancelled. */
  cancelled: number;
  moved: { chats: number; wallets: number };
};

/** A trade still being sent; the link waits for it (`account_link_busy`). */
export type TelegramLinkInFlight = {
  id: string;
  state: string;
  chain: string | null;
  transaction_url: string | null;
};

/**
 * A refused link request. `error` is the server's code; `extras` holds the
 * rest of the body (`same_account`, `reason`, `in_flight`).
 */
export class TelegramLinkError extends AomiApiError {
  readonly error: TelegramLinkErrorCode;
  readonly extras: Record<string, unknown>;

  constructor(status: number, body: unknown) {
    const record = asRecord(body) ?? {};
    const { error, ...extras } = record;
    const code = stringValue(error) ?? `http_${status}`;
    super(status, code, `Telegram link failed: ${code}`);
    this.name = "TelegramLinkError";
    this.error = code;
    this.extras = extras;
  }

  /** `telegram_already_linked` to the signed-in account itself. */
  get sameAccount(): boolean {
    return this.extras.same_account === true;
  }

  /** The trades `account_link_busy` waited for. */
  get inFlight(): TelegramLinkInFlight[] {
    const list = this.extras.in_flight;
    return (Array.isArray(list) ? list : []).flatMap((entry) => {
      const item = asRecord(entry);
      const id = stringValue(item?.id);
      return id
        ? [
            {
              id,
              state: stringValue(item?.state) ?? "",
              chain: stringValue(item?.chain) ?? null,
              transaction_url: stringValue(item?.transaction_url) ?? null,
            },
          ]
        : [];
    });
  }
}

export const telegramLinkPaths = {
  preview: "/v1/account/link/telegram/preview",
  confirm: "/v1/account/link/telegram/confirm",
  cancel: "/v1/account/link/telegram/cancel",
} as const;

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** Portal sessions only. Failures are `TelegramLinkError`. */
export class AccountTelegramLinkTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  /** What linking would move. Does not use up the code. */
  async previewTelegramLink(code: string): Promise<TelegramLinkPreview> {
    return parsePreview(await this.post(telegramLinkPaths.preview, code));
  }

  /**
   * Fold the Telegram account into this one. Can take up to about 30 s while
   * trades in progress finish; `account_link_busy` leaves the code usable.
   */
  async confirmTelegramLink(code: string): Promise<TelegramLinkResult> {
    return parseResult(await this.post(telegramLinkPaths.confirm, code));
  }

  /** Throw the code away so it can't be used. */
  async cancelTelegramLink(code: string): Promise<void> {
    await this.post(telegramLinkPaths.cancel, code);
  }

  private async post(path: string, code: string): Promise<unknown> {
    const headers = new Headers();
    headers.set("X-Aomi-CSRF", "1");
    const response = await this.requestResponse("POST", path, {
      headers,
      body: { code },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) throw new TelegramLinkError(response.status, body);
    return body;
  }
}

export function parsePreview(value: unknown): TelegramLinkPreview {
  const record = asRecord(value);
  if (!record) throw invalid("preview must be an object");
  const telegram = asRecord(record.telegram) ?? {};
  const moves = asRecord(record.moves) ?? {};
  const pending = asRecord(moves.pending_trades) ?? {};
  return {
    telegram: {
      username: stringValue(telegram.username) ?? null,
      bots: bots(telegram.bots),
      linked_from: bot(telegram.linked_from),
    },
    account: {
      label: stringValue(asRecord(record.account)?.label) ?? "",
    },
    survivor: "this_account",
    moves: {
      agent_wallets: list(moves.agent_wallets).flatMap((entry) => {
        const wallet = asRecord(entry);
        const id = stringValue(wallet?.id);
        if (!wallet || !id) return [];
        return [
          {
            id,
            family: wallet.family === "svm" ? "svm" : "evm",
            address: stringValue(wallet.address) ?? "",
            label: stringValue(wallet.label) ?? "Agent wallet",
            total_usd: stringValue(wallet.total_usd) ?? null,
            becomes: wallet.becomes === "default" ? "default" : "extra",
          },
        ];
      }),
      chats_in_bots: count(moves.chats_in_bots),
      scheduled_jobs: count(moves.scheduled_jobs),
      pending_trades: {
        cancel: count(pending.cancel),
        wait: count(pending.wait),
      },
      world: list(moves.world).flatMap((entry) => {
        const item = asRecord(entry);
        const name = stringValue(item?.bot);
        return name
          ? [{ bot: name, state: stringValue(item?.state) ?? "" }]
          : [];
      }),
    },
    expires_at: count(record.expires_at),
  };
}

export function parseResult(value: unknown): TelegramLinkResult {
  const record = asRecord(value);
  if (!record || record.linked !== true)
    throw invalid("result must say linked");
  const moved = asRecord(record.moved) ?? {};
  return {
    linked: true,
    telegram: {
      username: stringValue(asRecord(record.telegram)?.username) ?? null,
    },
    wallets: list(record.wallets).flatMap((entry) => {
      const wallet = asRecord(entry);
      const id = stringValue(wallet?.id);
      if (!wallet || !id) return [];
      return [
        {
          id,
          address: stringValue(wallet.address) ?? "",
          role: wallet.role === "default" ? "default" : "extra",
        },
      ];
    }),
    cancelled: count(record.cancelled),
    moved: { chats: count(moved.chats), wallets: count(moved.wallets) },
  };
}

function bot(value: unknown): TelegramLinkBot | null {
  const record = asRecord(value);
  const id = stringValue(record?.bot_id);
  return id ? { bot_id: id, label: stringValue(record?.label) ?? id } : null;
}

function bots(value: unknown): TelegramLinkBot[] {
  return list(value).flatMap((entry) => {
    const parsed = bot(entry);
    return parsed ? [parsed] : [];
  });
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function invalid(detail: string): TypeError {
  return new TypeError(`Invalid Telegram link response: ${detail}`);
}
