import { AomiClient, wrapFetchWithPublicApiAuthorization } from "../client";
import type { AomiOAuthTokenProvider } from "../authorization";
import type { AomiIngestSecretsResponse } from "../types";
import type { ClientSession } from "../session";
import type { CliConfig } from "./types";
import { CliSession } from "./cli-session";
import { createCliAuthTokenProvider } from "./auth";
import {
  createCliGetAccountBearer,
  DEFAULT_CLI_BASE_URL,
} from "./client-factory";
import { createCliPaymentFetch, type CliPaymentListener } from "./payment";
import { readState } from "./state";

export function createControlClient(
  config: CliConfig,
  options: { payment?: boolean; onPayment?: CliPaymentListener } = {},
): AomiClient {
  const cli = CliSession.load();
  const baseUrl = config.baseUrl ?? DEFAULT_CLI_BASE_URL;
  const oauth: AomiOAuthTokenProvider | undefined = config.accountBearer
    ? async ({ resource, scopes }) => ({
        accessToken: config.accountBearer!,
        expiresAt: Number.MAX_SAFE_INTEGER,
        resource,
        scopes,
        tokenType: "Bearer",
      })
    : cli?.createOAuthProvider(fetch);
  const authorizedFetch = oauth
    ? wrapFetchWithPublicApiAuthorization({ fetch, baseUrl, oauth })
    : fetch;
  const paymentFetch = options.payment
    ? createCliPaymentFetch(config, options.onPayment, authorizedFetch)
    : undefined;
  return new AomiClient({
    baseUrl,
    apiKey: config.apiKey,
    fetch: paymentFetch ?? fetch,
    // Payment settlement retries happen inside the x402 wrapper. Put OAuth
    // inside that wrapper so a newly-added Payment-Signature is authorized
    // again with payments:submit instead of reusing the narrower first token.
    oauth: paymentFetch ? undefined : oauth,
    guest: oauth ? false : (cli?.createGuestProvider(fetch, baseUrl) ?? true),
    getAccountBearer:
      createCliGetAccountBearer(config) ??
      createCliAuthTokenProvider(() => readState() ?? {}),
  });
}

export async function ingestSecretsForSession(
  config: CliConfig,
  cli: CliSession,
  client: AomiClient,
): Promise<Record<string, string>> {
  const secrets = config.secrets;
  if (Object.keys(secrets).length === 0) return {};

  const clientId = cli.ensureClientId();

  const response: AomiIngestSecretsResponse = await client.ingestSecrets(
    cli.sessionId,
    clientId,
    secrets,
  );

  cli.addSecretHandles(response.handles);
  return response.handles;
}

export async function applyRequestedModelIfPresent(
  config: CliConfig,
  cli: CliSession,
  session: ClientSession,
): Promise<void> {
  const requestedModel = config.model;
  if (!requestedModel) {
    return;
  }

  // ClientSession carries the model on the canonical Agent start request.
  // Retain this helper only to persist the CLI preference; it must not issue a
  // second legacy control mutation before chat.
  void session;
  cli.setModel(requestedModel);
}
