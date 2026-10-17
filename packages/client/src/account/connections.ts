/**
 * Connections: the portal, each OAuth client (AI clients over MCP, SDK apps,
 * the Aomi CLI) and each Telegram bot that uses the account, with its
 * Ask/Instant setting, label and last use.
 *
 * HAND-WRITTEN WIRE TYPES, matching notes/redesign-contract.md §4.1–§4.2:
 *   - `GET    /v1/account/connections`                  -> `AomiAccountConnections` (portal)
 *   - `DELETE /v1/account/connections/oauth/:client_id` -> `{ revoked: true }` (portal)
 *   - `DELETE /v1/account/connections/telegram`         -> `{ revoked: true }` (portal)
 *   - `PUT    /v1/account/connection-settings/:key`     -> `AomiConnectionSettings` (backend)
 */
import { asRecord, stringValue } from "../internal/record";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";
import { walletError } from "./wallets";

export type AomiConnectionKind = "portal" | "ai" | "app" | "cli" | "telegram";

export type AomiAccountConnection = {
  /** `portal`, `oauth:<client id>`, `telegram:<bot id>` or `cli`. */
  key: string;
  kind: AomiConnectionKind;
  /** The user's label, else the registered name, else `@bot`. */
  name: string;
  /** `Telegram @user` for a bot; null otherwise. */
  detail: string | null;
  /** Signs without asking; otherwise each trade waits for approval. */
  instant: boolean;
  /** Unix seconds. */
  last_used_at: number | null;
  /** Unix seconds. */
  connected_at: number | null;
  /** Every connection but the portal. */
  removable: boolean;
};

/** The portal first, then by last use. */
export type AomiAccountConnections = { connections: AomiAccountConnection[] };

/** One connection's own settings; omitted fields keep their value. */
export type AomiConnectionSettingsUpdate = {
  /** Trimmed, up to 40 characters; empty or null clears it. */
  label?: string | null;
  instant?: boolean;
};

export type AomiConnectionSettings = Pick<
  AomiAccountConnection,
  "key" | "instant" | "last_used_at"
> & { label: string | null };

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

  /** Ask/Instant and the label of one connection. */
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
      instant: record.instant === true,
      last_used_at: unixOrNull(record.last_used_at),
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
          instant: row.instant === true,
          last_used_at: unixOrNull(row.last_used_at),
          connected_at: unixOrNull(row.connected_at),
          removable: row.removable === true,
        },
      ];
    }),
  };
}

const unixOrNull = (value: unknown) =>
  typeof value === "number" ? value : null;
