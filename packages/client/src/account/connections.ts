/**
 * Connections: the portal, each OAuth client (AI clients over MCP, SDK apps,
 * the Aomi CLI) and each Telegram bot that uses the account, with its lane
 * on each agent wallet, its label and last use.
 *
 * HAND-WRITTEN WIRE TYPES, matching notes/redesign-contract.md §4.1–§4.2 and
 * notes/rework-contract.md §5:
 *   - `GET    /v1/account/connections`                  -> `AomiAccountConnections` (portal)
 *   - `DELETE /v1/account/connections/oauth/:client_id` -> `{ revoked: true }` (portal)
 *   - `DELETE /v1/account/connections/telegram`         -> `{ revoked: true }` (portal)
 *   - `PUT    /v1/account/connection-settings/:key`     -> `AomiConnectionSettings` (backend)
 *   - `PUT    /v1/account/connections/:key/wallets`     -> `{ ask_only, wallets }` (backend)
 */
import { asRecord, stringValue } from "../internal/record";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";
import { walletError } from "./wallets";
import { laneOf, type AomiLane } from "./lanes";

export { defaultLane, laneOf, type AomiLane } from "./lanes";

export type AomiConnectionKind = "portal" | "ai" | "app" | "cli" | "telegram";

export type AomiAccountConnection = {
  /** `portal`, `oauth:<client id>`, `telegram:<bot id>` or `cli`. */
  key: string;
  kind: AomiConnectionKind;
  /** The user's label, else the registered name, else `@bot`. */
  name: string;
  /**
   * `Telegram @user` for a bot; `Agent MCP` or `Pipeline MCP` for an AI
   * client (which MCP it signed in to); null otherwise.
   */
  detail: string | null;
  /** A Telegram bot's handles: the linked user (`@user`) and the bot (`@bot`). */
  telegram: AomiConnectionTelegram | null;
  /** The app this connection is locked to; null when it is open. */
  application: AomiConnectionApp | null;
  /** Always `aomi`, whatever its wallets say. */
  ask_only: boolean;
  /** Its lanes set on agent wallets; a wallet left out has the default. */
  wallets: AomiConnectionWallet[];
  /** Unix seconds. */
  last_used_at: number | null;
  /** Unix seconds. */
  connected_at: number | null;
  /** Every connection but the portal. */
  removable: boolean;
};

export type AomiConnectionApp = { id: number; name: string; label: string };

export type AomiConnectionTelegram = { user: string | null; bot: string };

/**
 * The connection's lane on agent wallet `id`. An archived wallet's lane is
 * listed (and must be sent back on a replace) but grants nothing.
 */
export type AomiConnectionWallet = {
  id: string;
  name: string;
  lane: AomiLane;
  archived: boolean;
};

/** The portal first, then by last use. */
export type AomiAccountConnections = { connections: AomiAccountConnection[] };

/** One connection's own settings; omitted fields keep their value. */
export type AomiConnectionSettingsUpdate = {
  /** Trimmed, up to 40 characters; empty or null clears it. */
  label?: string | null;
};

export type AomiConnectionSettings = Pick<
  AomiAccountConnection,
  "key" | "last_used_at"
> & { label: string | null };

/**
 * A connection's lanes on agent wallets; it replaces the lanes it had (a
 * wallet left out goes back to the default). `application` (an app's name,
 * from app-locked consent) locks the connection to that app. On an Ask-only
 * connection every lane is stored as `aomi`.
 */
export type AomiConnectionWalletsUpdate = {
  wallets: { id: string; lane: AomiLane }[];
  application?: string;
  /**
   * With `application`: make the app's wallet now, in this lane, when none
   * of `wallets` is one the app made.
   */
  new_app_wallet?: { lane: AomiLane };
  ask_only?: boolean;
};

const KINDS: readonly AomiConnectionKind[] = [
  "portal",
  "ai",
  "app",
  "cli",
  "telegram",
];

export const connectionPaths = {
  list: "/v1/account/connections",
  oauth: (clientId: string) =>
    `/v1/account/connections/oauth/${encodeURIComponent(clientId)}`,
  telegram: "/v1/account/connections/telegram",
  settings: (key: string) =>
    `/v1/account/connection-settings/${encodeURIComponent(key)}`,
  wallets: (key: string) =>
    `/v1/account/connections/${encodeURIComponent(key)}/wallets`,
} as const;

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** Portal sessions only. Failures are `AomiWalletError` with the server's code. */
export class AccountConnectionsTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  async list(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAccountConnections> {
    return parseConnections(
      await this.request("GET", connectionPaths.list, options),
    );
  }

  /** One connection's label and whether it may approve its own trades. */
  async setConnectionSettings(
    key: string,
    update: AomiConnectionSettingsUpdate,
  ): Promise<AomiConnectionSettings> {
    const record = asRecord(
      await this.request("PUT", connectionPaths.settings(key), {
        body: update,
      }),
    );
    if (!record) throw new TypeError("Invalid connection settings response");
    return {
      key: stringValue(record.key) ?? key,
      label: stringValue(record.label) ?? null,
      last_used_at: unixOrNull(record.last_used_at),
    };
  }

  /** Replace the agent wallets a connection may use. Portal sessions only. */
  async setConnectionWallets(
    key: string,
    update: AomiConnectionWalletsUpdate,
  ): Promise<{ ask_only: boolean; wallets: AomiConnectionWallet[] }> {
    const record = asRecord(
      await this.request("PUT", connectionPaths.wallets(key), { body: update }),
    );
    return {
      ask_only: record?.ask_only === true,
      wallets: walletsOf(record?.wallets),
    };
  }

  /**
   * Revoke one OAuth client: its consent and refresh tokens go at once; an
   * access token it already holds works until it expires.
   */
  async disconnectOAuth(clientId: string): Promise<void> {
    await this.request("DELETE", connectionPaths.oauth(clientId));
  }

  /**
   * Unlink Telegram: the bots stop acting for this account and the next
   * message there starts a fresh one. Fails with
   * `cannot_unlink_last_login_factor` when Telegram is the only sign-in.
   */
  async disconnectTelegram(): Promise<void> {
    await this.request("DELETE", connectionPaths.telegram);
  }

  private async request(
    method: AomiHttpMethod,
    path: string,
    options: AomiRequestOptions = {},
  ): Promise<unknown> {
    const headers = new Headers(options.headers);
    if (method !== "GET") headers.set("X-Aomi-CSRF", "1");
    const response = await this.requestResponse(method, path, {
      ...options,
      headers,
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) throw walletError(response.status, body);
    return body;
  }
}

export function parseConnections(value: unknown): AomiAccountConnections {
  const list = asRecord(value)?.connections;
  if (!Array.isArray(list)) throw new TypeError("Invalid connections response");
  return {
    connections: list.flatMap((entry) => {
      const row = asRecord(entry);
      const key = stringValue(row?.key);
      const kind = row?.kind as AomiConnectionKind;
      if (!row || !key || !KINDS.includes(kind)) return [];
      return [
        {
          key,
          kind,
          name: stringValue(row.name) ?? key,
          detail: stringValue(row.detail) ?? null,
          telegram: telegramOf(row.telegram),
          application: appOf(row.application),
          ask_only: row.ask_only === true,
          wallets: walletsOf(row.wallets),
          last_used_at: unixOrNull(row.last_used_at),
          connected_at: unixOrNull(row.connected_at),
          removable: row.removable === true,
        },
      ];
    }),
  };
}

function telegramOf(value: unknown): AomiConnectionTelegram | null {
  const handles = asRecord(value);
  const bot = stringValue(handles?.bot);
  return handles && bot
    ? { user: stringValue(handles.user) ?? null, bot }
    : null;
}

function appOf(value: unknown): AomiConnectionApp | null {
  const app = asRecord(value);
  const name = stringValue(app?.name);
  if (!app || typeof app.id !== "number" || !name) return null;
  return { id: app.id, name, label: stringValue(app.label) ?? name };
}

function walletsOf(value: unknown): AomiConnectionWallet[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const wallet = asRecord(entry);
    const id = stringValue(wallet?.id);
    return id
      ? [
          {
            id,
            name: stringValue(wallet?.name) ?? "",
            lane: laneOf(wallet?.lane),
            archived: wallet?.archived === true,
          },
        ]
      : [];
  });
}

const unixOrNull = (value: unknown) =>
  typeof value === "number" ? value : null;
