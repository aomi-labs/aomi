import { createHash, randomBytes } from "node:crypto";
import {
  widgetAuthStore,
  type WidgetAuthStore,
  type WidgetAuthTicket,
} from "./store";

export const WIDGET_OAUTH_BOOTSTRAP_TTL_SECONDS = 90;
const TICKET_PREFIX = "aomi_obt_";
const IDENTIFIER_PREFIX = "aomi:widget:oauth-bootstrap:";

export async function issueWidgetOAuthBootstrapTicket(input: {
  origin: string;
  userId: string;
  authMethod: string;
  providerIdentityId?: string;
  widgetSessionIdentifier: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scopes: readonly string[];
  stateDigest: string;
  channelNonceDigest: string;
  now?: Date;
  store?: WidgetAuthStore;
}): Promise<{ ticket: string; expiresAt: number }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + WIDGET_OAUTH_BOOTSTRAP_TTL_SECONDS * 1000,
  );
  const ticket = `${TICKET_PREFIX}${randomBytes(32).toString("base64url")}`;
  await (input.store ?? widgetAuthStore).write({
    identifier: ticketIdentifier(ticket),
    expiresAt,
    ticket: {
      kind: "widget_oauth_bootstrap",
      origin: input.origin,
      userId: input.userId,
      authMethod: input.authMethod,
      providerIdentityId: input.providerIdentityId,
      widgetSessionIdentifier: input.widgetSessionIdentifier,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      scopes: [...input.scopes],
      stateDigest: input.stateDigest,
      channelNonceDigest: input.channelNonceDigest,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
  return { ticket, expiresAt: Math.floor(expiresAt.getTime() / 1000) };
}

export async function consumeWidgetOAuthBootstrapTicket(input: {
  ticket: string;
  now?: Date;
  store?: WidgetAuthStore;
}): Promise<Extract<
  WidgetAuthTicket,
  { kind: "widget_oauth_bootstrap" }
> | null> {
  if (!input.ticket.startsWith(TICKET_PREFIX)) return null;
  const ticket = await (input.store ?? widgetAuthStore).consume({
    identifier: ticketIdentifier(input.ticket),
    now: input.now ?? new Date(),
  });
  return ticket?.kind === "widget_oauth_bootstrap" ? ticket : null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ticketIdentifier(ticket: string): string {
  return `${IDENTIFIER_PREFIX}${sha256Hex(ticket)}`;
}
