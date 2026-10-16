/**
 * Connected apps (Agent Wallets v1, step 4): the OAuth clients that hold a
 * grant on the account, and the linked Telegram user.
 *
 * HAND-WRITTEN WIRE TYPES, matching notes/step4-contract.md §5 "Endpoints
 * behind Safety". These routes are portal-only (served by the portal from the
 * Better Auth tables, never by the backend), so they have no OpenAPI schema:
 *   - `GET    /v1/account/connections`                 -> `AomiAccountConnections`
 *   - `DELETE /v1/account/connections/oauth/:client_id` -> `{ revoked: true }`
 * Step 5 (notes/step5-contract.md §4.2) adds `telegram.linked_from` and
 * `telegram.linked_at`.
 */
import { asRecord, stringValue } from "../internal/record";
import type { AomiHttpMethod, AomiRequestOptions } from "../types";
import { walletError } from "./wallets";

/** `mcp`: an AI client over MCP. `cli`: the Aomi CLI. `api`: anything else. */
export type AomiConnectionKind = "mcp" | "cli" | "api";

export type AomiOAuthConnection = {
  client_id: string;
  name: string;
  kind: AomiConnectionKind;
  /** Unix seconds. */
  connected_at: number | null;
};

export type AomiTelegramConnection = {
  username: string | null;
  /** The bots this Telegram user has chatted with. */
  bots: { bot_id: string; label: string }[];
  /** The bot whose `/link` code linked it to this account; null if never linked. */
  linked_from: { bot_id: string; label: string } | null;
  /** Unix seconds of that link. */
  linked_at: number | null;
};

export type AomiAccountConnections = {
  oauth: AomiOAuthConnection[];
  /** Null when no Telegram user is linked. */
  telegram: AomiTelegramConnection | null;
};

export const connectionPaths = {
  list: "/v1/account/connections",
  oauth: (clientId: string) =>
    `/v1/account/connections/oauth/${encodeURIComponent(clientId)}`,
} as const;

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** Portal sessions only. Failures are `AomiWalletError` with the server's code. */
export class AccountConnectionsTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  /** Every OAuth client with a grant on the account, and Telegram. */
  async list(
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiAccountConnections> {
    return parseConnections(
      await this.request("GET", connectionPaths.list, options),
    );
  }

  /**
   * Revoke one OAuth client: its consent and refresh tokens go at once; an
   * access token it already holds works until it expires.
   */
  async disconnectOAuth(clientId: string): Promise<void> {
    await this.request("DELETE", connectionPaths.oauth(clientId));
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
  const record = asRecord(value);
  if (!record) throw new TypeError("Invalid connections response");
  const telegram = asRecord(record.telegram);
  return {
    oauth: (Array.isArray(record.oauth) ? record.oauth : []).flatMap(
      (entry) => {
        const client = asRecord(entry);
        const id = stringValue(client?.client_id);
        if (!client || !id) return [];
        const kind = client.kind;
        return [
          {
            client_id: id,
            name: stringValue(client.name) ?? id,
            kind: kind === "mcp" || kind === "cli" ? kind : "api",
            connected_at:
              typeof client.connected_at === "number"
                ? client.connected_at
                : null,
          },
        ];
      },
    ),
    telegram: telegram
      ? {
          username: stringValue(telegram.username) ?? null,
          bots: (Array.isArray(telegram.bots) ? telegram.bots : []).flatMap(
            (entry) => {
              const bot = parseBot(entry);
              return bot ? [bot] : [];
            },
          ),
          linked_from: parseBot(telegram.linked_from),
          linked_at:
            typeof telegram.linked_at === "number" ? telegram.linked_at : null,
        }
      : null,
  };
}

function parseBot(value: unknown): { bot_id: string; label: string } | null {
  const bot = asRecord(value);
  const id = stringValue(bot?.bot_id);
  return id ? { bot_id: id, label: stringValue(bot?.label) ?? id } : null;
}
