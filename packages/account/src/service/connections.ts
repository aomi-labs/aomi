import { aomiOAuthResources } from "../better-auth/oauth-policy";
import {
  deleteOAuthConnection,
  findTelegramConnection,
  listOAuthConnections,
} from "../db/queries";
import type { AomiUserId } from "../types";

/*
 * Wire types of the portal-only connection routes (Agent Wallets v1 step 4):
 *   GET    /v1/account/connections                  -> AccountConnections
 *   DELETE /v1/account/connections/oauth/:client_id -> { revoked: true }
 * The client mirrors them in packages/client/src/account/connections.ts.
 */

/** `mcp`: bound to an MCP resource. `cli`: the Aomi CLI. `api`: anything else. */
export type ConnectionKind = "mcp" | "cli" | "api";

export type OAuthConnection = {
  client_id: string;
  name: string;
  kind: ConnectionKind;
  /** Unix seconds of the oldest consent or refresh token. */
  connected_at: number;
};

export type AccountConnections = {
  oauth: OAuthConnection[];
  /** Null when the account has no Telegram identity. */
  telegram: {
    username: string | null;
    bots: { bot_id: string; label: string }[];
  } | null;
};

const CLI_CLIENT_NAME = "Aomi CLI";

export async function listAccountConnections(
  userId: AomiUserId,
): Promise<AccountConnections> {
  const resources = aomiOAuthResources();
  const mcp = new Set<string>([resources.agentMcp, resources.pipelineMcp]);
  const [oauth, telegram] = await Promise.all([
    listOAuthConnections(userId),
    findTelegramConnection(userId),
  ]);
  return {
    oauth: oauth.map((client) => ({
      client_id: client.clientId,
      name: client.name ?? client.clientId,
      kind: client.resources.some((resource) => mcp.has(resource))
        ? "mcp"
        : client.name === CLI_CLIENT_NAME
          ? "cli"
          : "api",
      connected_at: client.connectedAt,
    })),
    telegram: telegram && {
      username: telegram.username,
      bots: telegram.bots.map((bot) => ({
        bot_id: bot.botId,
        label: bot.label,
      })),
    },
  };
}

/**
 * Disconnect one OAuth client: its consent and refresh tokens go at once; a
 * JWT access token it already holds works until it expires.
 */
export function revokeOAuthConnection(input: {
  userId: AomiUserId;
  clientId: string;
}): Promise<boolean> {
  return deleteOAuthConnection(input);
}
