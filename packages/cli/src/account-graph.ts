import { privateKeyToAccount } from "viem/accounts";
import { normalizeBaseUrl } from "./auth";
import type { CliSession } from "./cli-session";
import { fatal } from "./errors";
import type { CliConfig } from "./types";

import {
  AomiClient,
  buildWalletLinkMessage,
  apiErrorFields,
} from "@aomi-labs/client";
import {
  AccountGraphTransport,
  AccountGraphApiError,
  type AccountGraphResponse,
  type ResolvedAccountLink,
} from "@aomi-labs/client";
import type { AccountCreditsTransport } from "@aomi-labs/client";
export type {
  AccountGraphUser,
  AccountGraphLinkedAccount,
  AccountGraphWallet,
  AccountGraphResponse,
  AccountGraphLinkWalletResponse,
  AccountGraphProviderExchangeResponse,
  AccountGraphDeleteResponse,
  ResolvedAccountLink,
} from "@aomi-labs/client";

/** Kept for CLI integrations; transport and shapes are owned by the public client. */
export class AccountGraphClient extends AccountGraphTransport {
  readonly credits: AccountCreditsTransport;
  constructor(input: {
    baseUrl: string;
    sessionToken: string;
    fetch?: typeof fetch;
  }) {
    const client = new AomiClient({
      baseUrl: input.baseUrl,
      fetch: input.fetch,
      getAccountBearer: async () => input.sessionToken,
    });
    super(client.requestResponse.bind(client));
    this.credits = client.account.credits;
  }
  protected override async request<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    try {
      return await super.request<T>(path, init);
    } catch (error) {
      if (error instanceof AccountGraphApiError)
        throw new Error(
          formatAccountGraphError(error.status, error.body, error.message),
        );
      throw error;
    }
  }
}

export function requireAccountGraphClient(
  cli: CliSession,
  fetchImpl?: typeof fetch,
): AccountGraphClient {
  const sessionToken = cli.accountBearer ?? cli.auth?.sessionToken;
  if (!sessionToken) {
    fatal(
      "No account session. Run `aomi account login` first or pass `--account-bearer`.",
    );
  }
  return new AccountGraphClient({
    baseUrl: cli.baseUrl,
    sessionToken: sessionToken!,
    fetch: fetchImpl,
  });
}

export function resolveAccountPrivateKey(
  cli: CliSession,
  config: CliConfig,
): `0x${string}` {
  const privateKey = config.privateKey ?? cli.privateKey;
  if (!privateKey) {
    fatal(
      "No EVM private key configured.\n" +
        "Run `aomi wallet set <evm-private-key>` or pass `--private-key`.",
    );
  }
  return privateKey as `0x${string}`;
}

export async function buildSignedWalletLink(input: {
  cli: CliSession;
  config: CliConfig;
  label?: string | null;
}): Promise<{
  family: "evm";
  address: string;
  chainId: number;
  nonce: string;
  message: string;
  signature: string;
  label?: string | null;
}> {
  const client = requireAccountGraphClient(input.cli);
  const privateKey = resolveAccountPrivateKey(input.cli, input.config);
  const account = privateKeyToAccount(privateKey);
  const chainId = input.config.chain ?? input.cli.chainId ?? 1;
  const nonce = await client.getWalletLinkNonce({
    address: account.address,
    chainId,
  });
  const baseUrl = normalizeBaseUrl(input.cli.baseUrl);
  const message = buildWalletLinkMessage({
    address: account.address,
    chainId,
    nonce: nonce.nonce,
    domain: nonce.domain ?? new URL(baseUrl).host,
    uri: nonce.uri ?? baseUrl,
  });
  const signature = await account.signMessage({ message });
  return {
    family: "evm",
    address: account.address,
    chainId,
    nonce: nonce.nonce,
    message,
    signature,
    label: input.label ?? null,
  };
}

export function resolveAccountLink(
  account: AccountGraphResponse,
  selector: string,
): ResolvedAccountLink | null {
  if (!account.user) return null;
  const raw = selector.trim();
  const separator = raw.indexOf(":");
  const [kindPrefix, idFromPrefix] =
    separator >= 0
      ? [raw.slice(0, separator), raw.slice(separator + 1)]
      : ["", ""];
  const wantedKind =
    kindPrefix === "identity" || kindPrefix === "wallet"
      ? kindPrefix
      : undefined;
  const id = wantedKind ? idFromPrefix : raw;
  if (!id) return null;

  const identity = account.linkedAccounts.find((link) => link.id === id);
  const wallet = account.wallets.find((link) => link.id === id);
  if (wantedKind === "identity") {
    return identity ? { kind: "identity", id, link: identity } : null;
  }
  if (wantedKind === "wallet") {
    return wallet ? { kind: "wallet", id, link: wallet } : null;
  }
  if (identity && wallet) {
    fatal(
      `Link id "${id}" is ambiguous. Use "identity:${id}" or "wallet:${id}".`,
    );
  }
  if (identity) return { kind: "identity", id, link: identity };
  if (wallet) return { kind: "wallet", id, link: wallet };
  return null;
}

function formatAccountGraphError(
  status: number,
  body: unknown,
  fallback: string,
): string {
  const { code: errorCode, message } = apiErrorFields(body);
  const code = errorCode ?? message;
  if (status === 401) {
    return "Session expired; run `aomi account login`";
  }
  if (status === 409 && code === "cannot_unlink_last_login_factor") {
    return "Cannot unlink the last login method. Link another account method first.";
  }
  if (status === 409 && code === "already_linked_to_another_account") {
    return "This login method is already linked to another Aomi account.";
  }
  if (status === 403 && code === "protected_identity") {
    return "This login identity is protected and cannot be edited directly.";
  }
  return code ?? fallback ?? `Request failed: HTTP ${status}`;
}
