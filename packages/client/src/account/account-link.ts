/**
 * Link a platform account (Telegram first) to the signed-in portal account.
 * The platform mints a one-time code (Telegram: `/link` in an Aomi app bot);
 * the portal page `/link/<provider>?code=…` previews what moves and confirms.
 *
 * Hand-written wire types for `/v1/account/link/<provider>/*`. The routes
 * are portal-session only (the Edge refuses every other credential), so they
 * are not part of the generated agent API and not exposed on `Aomi`:
 *   - `POST /v1/account/link/<provider>/preview` -> `LinkPreview`
 *   - `POST /v1/account/link/<provider>/confirm` -> `LinkResult`
 *   - `POST /v1/account/link/<provider>/cancel`  -> `{ cancelled: true }`
 * Each takes `{ "code": "<43 chars>" }` in the body, never in the URL.
 */
import { AomiApiError } from "../api-error";
import { asRecord, responseReader, stringValue } from "../internal/record";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";

const { invalid } = responseReader("Account link");

/** The platforms an account can be linked from. */
export type AccountLinkProvider = "telegram";

/** A link code: 32 random bytes, base64url without padding. */
const LINK_CODE = /^[A-Za-z0-9_-]{43}$/;

/** True for a well-formed link code; anything else is never sent. */
export function isLinkCode(value: unknown): value is string {
  return typeof value === "string" && LINK_CODE.test(value);
}

export type LinkBot = { bot_id: string; label: string };

/** An agent wallet that moves to this account. */
export type LinkWalletMove = {
  id: string;
  family: "evm" | "svm";
  /** Short form, e.g. `0x7a3f…c41e`. */
  address: string;
  label: string;
};

/** What every provider's link moves into this account. */
export type LinkMoves = {
  agent_wallets: LinkWalletMove[];
  scheduled_jobs: number;
  /** Trades waiting for approval (cancelled) and being sent (waited for). */
  pending_trades: { cancel: number; wait: number };
};

/** The Telegram side of a link preview. */
export type TelegramLinkIdentity = {
  username: string | null;
  /** The bots this user chats with. */
  bots: LinkBot[];
  /** The bot that issued the code. */
  linked_from: LinkBot | null;
};

type LinkPreviewShared = {
  /** The signed-in account, which survives. */
  account: { label: string };
  survivor: "this_account";
  moves: LinkMoves;
  /** Unix seconds. */
  expires_at: number;
};

export type TelegramLinkPreview = LinkPreviewShared & {
  provider: "telegram";
  identity: TelegramLinkIdentity;
  moves: { chats_in_bots: number };
};

/**
 * `POST /v1/account/link/<provider>/preview`: read-only, does not claim the
 * code. The shared envelope plus the part `provider` selects.
 */
export type LinkPreview = TelegramLinkPreview;

type LinkResultShared = {
  linked: true;
  wallets: { id: string; address: string }[];
  /** Trades that were waiting for approval and were cancelled. */
  cancelled: number;
  moved: { chats: number; wallets: number };
};

export type TelegramLinkResult = LinkResultShared & {
  provider: "telegram";
  identity: Pick<TelegramLinkIdentity, "username">;
};

/** `POST /v1/account/link/<provider>/confirm`. A repeat returns the same result. */
export type LinkResult = TelegramLinkResult;

/** A trade still being sent; the link waits for it (`account_link_busy`). */
export type LinkInFlight = {
  id: string;
  state: string;
  chain: string | null;
  transaction_url: string | null;
};

/**
 * A refused link request. `error` is the server's code; `extras` holds the
 * rest of the body (`same_account`, `reason`, `in_flight`).
 */
export class LinkError extends AomiApiError {
  readonly error: string;
  readonly extras: Record<string, unknown>;

  constructor(status: number, body: unknown) {
    const { error, ...extras } = asRecord(body) ?? {};
    const code = stringValue(error) ?? `http_${status}`;
    super(status, code, `Account link failed: ${code}`);
    this.name = "LinkError";
    this.error = code;
    this.extras = extras;
  }

  /** `identity_already_linked` to the signed-in account itself. */
  get sameAccount(): boolean {
    return this.extras.same_account === true;
  }

  /** The trades `account_link_busy` waited for. */
  get inFlight(): LinkInFlight[] {
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

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** Portal sessions only. Failures are `LinkError`. */
export class AccountLinkTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  /** What linking would move. Does not use up the code. */
  async previewLink(
    provider: AccountLinkProvider,
    code: string,
  ): Promise<LinkPreview> {
    return parsePreview(await this.post(provider, "preview", code));
  }

  /**
   * Fold the platform account into this one. Can take up to about 30 s while
   * trades in progress finish; `account_link_busy` leaves the code usable.
   */
  async confirmLink(
    provider: AccountLinkProvider,
    code: string,
  ): Promise<LinkResult> {
    return parseResult(await this.post(provider, "confirm", code));
  }

  /** Throw the code away so it can't be used. */
  async cancelLink(provider: AccountLinkProvider, code: string): Promise<void> {
    await this.post(provider, "cancel", code);
  }

  private async post(
    provider: AccountLinkProvider,
    action: "preview" | "confirm" | "cancel",
    code: string,
  ): Promise<unknown> {
    const response = await this.requestResponse(
      "POST",
      `/v1/account/link/${provider}/${action}`,
      { headers: { "X-Aomi-CSRF": "1" }, body: { code } },
    );
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) throw new LinkError(response.status, body);
    return body;
  }
}

function parseProvider(value: unknown): AccountLinkProvider {
  if (value === "telegram") return value;
  throw invalid("unknown link provider");
}

function parsePreview(value: unknown): LinkPreview {
  const record = asRecord(value);
  if (!record) throw invalid("preview must be an object");
  const provider = parseProvider(record.provider);
  const identity = asRecord(record.identity) ?? {};
  const moves = asRecord(record.moves) ?? {};
  const pending = asRecord(moves.pending_trades) ?? {};
  return {
    provider,
    identity: {
      username: stringValue(identity.username) ?? null,
      bots: list(identity.bots).flatMap((entry) => bot(entry) ?? []),
      linked_from: bot(identity.linked_from),
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
          },
        ];
      }),
      chats_in_bots: count(moves.chats_in_bots),
      scheduled_jobs: count(moves.scheduled_jobs),
      pending_trades: {
        cancel: count(pending.cancel),
        wait: count(pending.wait),
      },
    },
    expires_at: count(record.expires_at),
  };
}

function parseResult(value: unknown): LinkResult {
  const record = asRecord(value);
  if (!record || record.linked !== true)
    throw invalid("result must say linked");
  const provider = parseProvider(record.provider);
  const moved = asRecord(record.moved) ?? {};
  return {
    linked: true,
    provider,
    identity: {
      username: stringValue(asRecord(record.identity)?.username) ?? null,
    },
    wallets: list(record.wallets).flatMap((entry) => {
      const wallet = asRecord(entry);
      const id = stringValue(wallet?.id);
      if (!wallet || !id) return [];
      return [
        {
          id,
          address: stringValue(wallet.address) ?? "",
        },
      ];
    }),
    cancelled: count(record.cancelled),
    moved: { chats: count(moved.chats), wallets: count(moved.wallets) },
  };
}

function bot(value: unknown): LinkBot | null {
  const record = asRecord(value);
  const id = stringValue(record?.bot_id);
  return id ? { bot_id: id, label: stringValue(record?.label) ?? id } : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
