import { aomiOAuthResources, appMcpName } from "../better-auth/oauth-policy";
import {
  deleteOAuthConnection,
  deleteTelegramConnectionSettings,
  findTelegramConnection,
  listTelegramIdentityIds,
  listConnectionSettings,
  listOAuthConnections,
} from "../db/queries";
import type { AomiUserId } from "../types";
import { unlinkAuthIdentity } from "./account-service";

/*
 * Wire types of the portal-only connection routes:
 *   GET    /v1/account/connections                  -> AccountConnections
 *   DELETE /v1/account/connections/oauth/:client_id -> { revoked: true }
 *   DELETE /v1/account/connections/telegram         -> { revoked: true }
 * The client mirrors them in packages/client/src/account/connections.ts.
 * Labels and wallet pairs are written by the backend
 * (`PUT /v1/account/connection-settings/:key`,
 * `PUT /v1/account/connections/:key/wallets`); this only reads them.
 */

export type ConnectionKind = "portal" | "ai" | "app" | "cli" | "telegram";

export type AccountConnection = {
  /** `portal`, `oauth:<client id>` or `telegram:<bot id>`. */
  key: string;
  kind: ConnectionKind;
  /** The user's label, else the registered name, else `@bot`. */
  name: string;
  /**
   * `Telegram @user` for a bot; `Agent MCP` or `Pipeline MCP` for an AI
   * client (which MCP it signed in to); null otherwise.
   */
  detail: string | null;
  /** A Telegram bot's handles: the linked user (`@user`) and the bot (`@bot`). */
  telegram: { user: string | null; bot: string } | null;
  /** The app this connection is locked to; null when it is open. */
  application: { id: number; name: string; label: string } | null;
  /** Always `aomi`, whatever its wallets say. */
  ask_only: boolean;
  /**
   * Its lanes set on agent wallets (`aomi`, `here`, `instant`); a wallet
   * left out has the client's default. An archived wallet's lane is kept
   * (marked) so it comes back on restore.
   */
  wallets: {
    id: string;
    name: string;
    lane: "aomi" | "here" | "instant";
    archived: boolean;
  }[];
  /** Unix seconds. */
  last_used_at: number | null;
  /** Unix seconds of the oldest consent or refresh token. */
  connected_at: number | null;
  /** OAuth clients only. */
  removable: boolean;
};

/** The portal first, then by last use. */
export type AccountConnections = { connections: AccountConnection[] };

/** The Aomi CLI names its clients `Aomi CLI · <machine>` (older ones `Aomi CLI`). */
const CLI_CLIENT_NAME = "Aomi CLI";
const isCliClient = (name: string | null) =>
  name === CLI_CLIENT_NAME ||
  Boolean(name?.startsWith(`${CLI_CLIENT_NAME} · `));

type OAuthClient = Awaited<ReturnType<typeof listOAuthConnections>>[number];

/**
 * One row per OAuth connection. A CLI login holds one client per Aomi
 * resource (each client is bound to one), so a machine's CLI clients fold
 * into one row keyed by its agent client: the one whose commits the rule sees.
 */
function oauthRows(clients: OAuthClient[], agentRest: string): OAuthClient[][] {
  const cli = new Map<string, OAuthClient[]>();
  const rows: OAuthClient[][] = [];
  for (const client of clients) {
    if (!isCliClient(client.name)) rows.push([client]);
    else if (cli.has(client.name!)) cli.get(client.name!)!.push(client);
    else {
      const group = [client];
      cli.set(client.name!, group);
      rows.push(group);
    }
  }
  return rows.map((group) =>
    [...group].sort(
      (a, b) =>
        Number(b.resources.includes(agentRest)) -
        Number(a.resources.includes(agentRest)),
    ),
  );
}

export async function listAccountConnections(
  userId: AomiUserId,
): Promise<AccountConnections> {
  const resources = aomiOAuthResources();
  const mcp = new Set<string>([resources.agentMcp, resources.pipelineMcp]);
  const [oauth, telegram, settings] = await Promise.all([
    listOAuthConnections(userId),
    findTelegramConnection(userId),
    listConnectionSettings(userId),
  ]);
  const saved = new Map(settings.map((setting) => [setting.key, setting]));
  const connection = (
    key: string,
    kind: ConnectionKind,
    name: string,
    rest: Pick<
      AccountConnection,
      "detail" | "telegram" | "connected_at" | "removable"
    >,
  ): AccountConnection => {
    const setting = saved.get(key);
    return {
      key,
      kind,
      name: setting?.label ?? name,
      application: setting?.application ?? null,
      ask_only: setting?.askOnly ?? false,
      wallets: setting?.wallets ?? [],
      last_used_at: setting?.lastUsedAt ?? null,
      ...rest,
    };
  };
  const bots = telegram
    ? [...telegram.bots, ...(telegram.linkedFrom ? [telegram.linkedFrom] : [])]
    : [];
  const others = [
    ...oauthRows(oauth, resources.agentRest).map(([client, ...rest]) =>
      connection(
        `oauth:${client.clientId}`,
        client.resources.some(
          (resource) => mcp.has(resource) || appMcpName(resource),
        )
          ? "ai"
          : isCliClient(client.name)
            ? "cli"
            : "app",
        isCliClient(client.name)
          ? client.name!.slice(`${CLI_CLIENT_NAME} · `.length) ||
              CLI_CLIENT_NAME
          : (client.name ?? client.clientId),
        {
          detail: client.resources.includes(resources.pipelineMcp)
            ? "Pipeline MCP"
            : client.resources.some(
                  (resource) =>
                    resource === resources.agentMcp || appMcpName(resource),
                )
              ? "Agent MCP"
              : null,
          telegram: null,
          connected_at: Math.min(
            client.connectedAt,
            ...rest.map((other) => other.connectedAt),
          ),
          removable: true,
        },
      ),
    ),
    ...bots
      .filter(
        (bot, index) =>
          bots.findIndex((other) => other.botId === bot.botId) === index,
      )
      .map((bot) =>
        connection(`telegram:${bot.botId}`, "telegram", bot.label, {
          detail: telegram?.username
            ? `Telegram @${telegram.username}`
            : "Telegram",
          telegram: {
            user: telegram?.username ? `@${telegram.username}` : null,
            bot: bot.label,
          },
          connected_at: null,
          removable: true,
        }),
      ),
  ].sort((a, b) => (b.last_used_at ?? -1) - (a.last_used_at ?? -1));
  return {
    connections: [
      connection("portal", "portal", "Aomi", {
        detail: null,
        telegram: null,
        connected_at: null,
        removable: false,
      }),
      ...others,
    ],
  };
}

/**
 * Disconnect one OAuth connection, with every client of the same CLI machine:
 * consents, refresh tokens and settings go at once; a JWT access token
 * already issued works until it expires.
 */
export async function revokeOAuthConnection(input: {
  userId: AomiUserId;
  clientId: string;
}): Promise<boolean> {
  const clients = await listOAuthConnections(input.userId);
  const name = clients.find((c) => c.clientId === input.clientId)?.name ?? null;
  const ids = isCliClient(name)
    ? clients.filter((c) => c.name === name).map((c) => c.clientId)
    : [input.clientId];
  let revoked = false;
  for (const clientId of ids)
    revoked =
      (await deleteOAuthConnection({ userId: input.userId, clientId })) ||
      revoked;
  return revoked;
}

/**
 * Unlink Telegram: its sign-in identity goes, so the bots no longer resolve
 * that Telegram user to this account (the next message there starts a fresh
 * account), and every bot's settings go with it. Chats stay on this account.
 * Refused when Telegram is the account's only way to sign in.
 */
export async function unlinkTelegramConnection(input: {
  userId: AomiUserId;
}): Promise<"revoked" | "not_found" | "last_factor"> {
  const ids = await listTelegramIdentityIds(input.userId);
  if (!ids.length) return "not_found";
  for (const identityId of ids) {
    const result = await unlinkAuthIdentity({
      userId: input.userId,
      identityId,
    });
    if (result === "last_factor" || result === "protected")
      return "last_factor";
  }
  await deleteTelegramConnectionSettings(input.userId);
  return "revoked";
}
