import { privateKeyToAccount } from "viem/accounts";
import { buildSiwsMessage } from "../siws";
import type { GetAccountBearer } from "../types";
import { parseSolanaKeypairSecret, signSolanaMessage } from "./solana-signer";
import type { CliAuthSession, CliSessionState } from "./state";

type SiweNonceResponse = {
  nonce?: unknown;
  domain?: unknown;
  uri?: unknown;
};

type SiweVerifyResponse = {
  token?: unknown;
  success?: unknown;
  user_id?: unknown;
  user?: {
    id?: unknown;
    walletAddress?: unknown;
    chainId?: unknown;
  };
};

type SiwsNonceResponse = SiweNonceResponse;

type SiwsVerifyResponse = {
  token?: unknown;
  success?: unknown;
  status?: unknown;
  user_id?: unknown;
  user?: {
    id?: unknown;
    walletAddress?: unknown;
    chainId?: unknown;
  };
};

type PortalAccountResponse = {
  session?: {
    betterAuthUserId?: unknown;
    expiresAt?: unknown;
  } | null;
};

export type CliSiweLoginOptions = {
  baseUrl: string;
  privateKey: `0x${string}`;
  chainId?: number;
  fetch?: typeof fetch;
  now?: () => number;
};

export type CliSiweLoginResult = {
  auth: CliAuthSession;
  address: `0x${string}`;
};

export type CliSvmCluster = NonNullable<CliSessionState["svmCluster"]>;

export type CliSiwsLoginOptions = {
  baseUrl: string;
  privateKey: string;
  chainId?: CliSvmCluster;
  fetch?: typeof fetch;
  now?: () => number;
};

export type CliSiwsLoginResult = {
  auth: CliAuthSession;
  address: string;
  chainId: CliSvmCluster;
};

export type CliSiwsLinkResult = {
  status: "linked" | "noop";
  address: string;
  chainId: CliSvmCluster;
};

const DEFAULT_CHAIN_ID = 1;
const DEFAULT_SVM_CLUSTER: CliSvmCluster = "solana:mainnet";
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_REFRESH_SKEW_MS = 30 * 1000;
const SESSION_TOKEN_HEADERS = ["set-auth-token", "x-auth-token", "auth-token"];

export function createCliAuthTokenProvider(
  readState: () => Pick<CliSessionState, "accountBearer" | "auth">,
  now: () => number = Date.now,
): GetAccountBearer {
  return async () => {
    const state = readState();
    const auth = state.auth;
    if (auth?.sessionToken && auth.expiresAt > now() + AUTH_REFRESH_SKEW_MS) {
      return auth.sessionToken;
    }
    return state.accountBearer;
  };
}

export async function signInWithCliSiwe({
  baseUrl,
  privateKey,
  chainId = DEFAULT_CHAIN_ID,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: CliSiweLoginOptions): Promise<CliSiweLoginResult> {
  const portalUrl = normalizeBaseUrl(baseUrl);
  const account = privateKeyToAccount(privateKey);
  const address = account.address;
  const nonceHttpResponse = await fetchImpl(
    joinUrl(portalUrl, "/api/auth/siwe/nonce"),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({}),
    },
  );
  if (!nonceHttpResponse.ok) {
    throw new Error(
      `SIWE nonce failed: HTTP ${nonceHttpResponse.status} ${await safeResponseText(
        nonceHttpResponse,
      )}`,
    );
  }
  const nonceResponse = (await nonceHttpResponse.json()) as SiweNonceResponse;
  const nonce =
    typeof nonceResponse.nonce === "string" ? nonceResponse.nonce : "";
  if (!nonce) {
    throw new Error("SIWE nonce response is missing nonce");
  }

  const message = buildSiweMessage({
    address,
    chainId,
    nonce,
    domain:
      normalizeDomain(nonceResponse.domain) ?? domainFromBaseUrl(portalUrl),
    uri: normalizeUri(nonceResponse.uri) ?? portalUrl,
  });
  const signature = await account.signMessage({ message });
  const verifyHeaders = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const verifyResponse = await fetchImpl(
    joinUrl(portalUrl, "/api/auth/siwe/verify"),
    {
      method: "POST",
      headers: verifyHeaders,
      credentials: "include",
      body: JSON.stringify({
        message,
        signature,
      }),
    },
  );

  if (!verifyResponse.ok) {
    throw new Error(
      `SIWE verify failed: HTTP ${verifyResponse.status} ${await safeResponseText(
        verifyResponse,
      )}`,
    );
  }

  const verifyBody = (await verifyResponse
    .json()
    .catch(() => ({}))) as SiweVerifyResponse;
  const sessionToken =
    getSessionTokenHeader(verifyResponse.headers) ??
    (typeof verifyBody.token === "string" ? verifyBody.token : "");
  if (!sessionToken) {
    throw new Error("SIWE verify response is missing BetterAuth session token");
  }

  const accountInfo = await fetchPortalAccount(
    fetchImpl,
    portalUrl,
    sessionToken,
  );
  const expiresAt =
    parseExpiresAt(accountInfo?.session?.expiresAt) ??
    now() + DEFAULT_SESSION_TTL_MS;

  return {
    address,
    auth: {
      sessionToken,
      expiresAt,
      walletFamily: "evm",
      walletAddress:
        typeof verifyBody.user?.walletAddress === "string"
          ? verifyBody.user.walletAddress
          : address,
      chainId:
        typeof verifyBody.user?.chainId === "number"
          ? verifyBody.user.chainId
          : chainId,
      betterAuthUserId:
        typeof accountInfo?.session?.betterAuthUserId === "string"
          ? accountInfo.session.betterAuthUserId
          : typeof verifyBody.user_id === "string"
            ? verifyBody.user_id
            : typeof verifyBody.user?.id === "string"
              ? verifyBody.user.id
              : undefined,
    },
  };
}

export async function signInWithCliSiws({
  baseUrl,
  privateKey,
  chainId = DEFAULT_SVM_CLUSTER,
  fetch: fetchImpl = fetch,
  now = Date.now,
}: CliSiwsLoginOptions): Promise<CliSiwsLoginResult> {
  const keypair = parseSolanaKeypairSecret(privateKey);
  const address = keypair.publicKey.toBase58();
  const result = await performCliSiws({
    baseUrl,
    address,
    chainId,
    intent: "sign-in",
    signMessage: (message) =>
      signSolanaMessage(
        Buffer.from(message, "utf8").toString("base64"),
        keypair,
      ).signatureBase64,
    fetch: fetchImpl,
    now,
  });
  if (!result.sessionToken) {
    throw new Error("SIWS verify response is missing BetterAuth session token");
  }

  const accountInfo = await fetchPortalAccount(
    fetchImpl,
    normalizeBaseUrl(baseUrl),
    result.sessionToken,
  );
  const expiresAt =
    parseExpiresAt(accountInfo?.session?.expiresAt) ??
    now() + DEFAULT_SESSION_TTL_MS;
  return {
    address,
    chainId,
    auth: {
      sessionToken: result.sessionToken,
      expiresAt,
      walletFamily: "svm",
      walletAddress: address,
      chainScope: chainId,
      betterAuthUserId:
        typeof accountInfo?.session?.betterAuthUserId === "string"
          ? accountInfo.session.betterAuthUserId
          : result.betterAuthUserId,
    },
  };
}

export async function linkCliSiwsWallet(input: {
  baseUrl: string;
  sessionToken: string;
  privateKey: string;
  chainId?: CliSvmCluster;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<CliSiwsLinkResult> {
  const keypair = parseSolanaKeypairSecret(input.privateKey);
  const address = keypair.publicKey.toBase58();
  const chainId = input.chainId ?? DEFAULT_SVM_CLUSTER;
  const result = await performCliSiws({
    baseUrl: input.baseUrl,
    address,
    chainId,
    intent: "link",
    sessionToken: input.sessionToken,
    signMessage: (message) =>
      signSolanaMessage(
        Buffer.from(message, "utf8").toString("base64"),
        keypair,
      ).signatureBase64,
    fetch: input.fetch ?? fetch,
    now: input.now ?? Date.now,
  });
  return {
    status: result.status === "noop" ? "noop" : "linked",
    address,
    chainId,
  };
}

async function performCliSiws(input: {
  baseUrl: string;
  address: string;
  chainId: CliSvmCluster;
  intent: "sign-in" | "link";
  sessionToken?: string;
  signMessage: (message: string) => string;
  fetch: typeof fetch;
  now: () => number;
}): Promise<{
  sessionToken?: string;
  betterAuthUserId?: string;
  status?: "linked" | "noop";
}> {
  const portalUrl = normalizeBaseUrl(input.baseUrl);
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  if (input.sessionToken) {
    headers.set("Authorization", `Bearer ${input.sessionToken}`);
  }
  const nonceHttpResponse = await input.fetch(
    joinUrl(portalUrl, "/api/auth/siws/nonce"),
    {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        walletAddress: input.address,
        chainId: input.chainId,
        intent: input.intent,
      }),
    },
  );
  if (!nonceHttpResponse.ok) {
    throw new Error(
      `SIWS nonce failed: HTTP ${nonceHttpResponse.status} ${await safeResponseText(
        nonceHttpResponse,
      )}`,
    );
  }
  const nonceResponse = (await nonceHttpResponse.json()) as SiwsNonceResponse;
  const nonce =
    typeof nonceResponse.nonce === "string" ? nonceResponse.nonce : "";
  if (!nonce) throw new Error("SIWS nonce response is missing nonce");

  const message = buildSiwsMessage({
    address: input.address,
    chainId: input.chainId,
    nonce,
    intent: input.intent,
    domain:
      normalizeDomain(nonceResponse.domain) ?? domainFromBaseUrl(portalUrl),
    uri: normalizeUri(nonceResponse.uri) ?? portalUrl,
    issuedAt: new Date(input.now()),
  });
  const signature = input.signMessage(message);
  const verifyResponse = await input.fetch(
    joinUrl(portalUrl, "/api/auth/siws/verify"),
    {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({
        message,
        signature,
        walletAddress: input.address,
        chainId: input.chainId,
        intent: input.intent,
      }),
    },
  );
  if (!verifyResponse.ok) {
    throw new Error(
      `SIWS verify failed: HTTP ${verifyResponse.status} ${await safeResponseText(
        verifyResponse,
      )}`,
    );
  }
  const body = (await verifyResponse
    .json()
    .catch(() => ({}))) as SiwsVerifyResponse;
  const status = body.status === "noop" ? "noop" : "linked";
  return {
    sessionToken:
      getSessionTokenHeader(verifyResponse.headers) ??
      (typeof body.token === "string" ? body.token : undefined),
    betterAuthUserId:
      typeof body.user?.id === "string" ? body.user.id : undefined,
    status,
  };
}

export async function signOutCliSession(input: {
  baseUrl: string;
  sessionToken?: string;
  fetch?: typeof fetch;
}): Promise<void> {
  if (!input.sessionToken) return;
  const response = await (input.fetch ?? fetch)(
    joinUrl(normalizeBaseUrl(input.baseUrl), "/api/auth/sign-out"),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.sessionToken}`,
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({}),
    },
  );
  if (!response.ok && response.status !== 401) {
    throw new Error(
      `Sign-out failed: HTTP ${response.status} ${await safeResponseText(
        response,
      )}`,
    );
  }
}

export function buildSiweMessage(input: {
  address: string;
  chainId: number;
  nonce: string;
  domain: string;
  uri: string;
}): string {
  return `${input.domain} wants you to sign in with your Ethereum account:
${input.address}

Sign in to Aomi.

URI: ${input.uri}
Version: 1
Chain ID: ${input.chainId}
Nonce: ${input.nonce}
Issued At: ${new Date().toISOString()}`;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Portal URL is required");
  return trimmed;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function domainFromBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "127.0.0.1") {
      return url.port ? `localhost:${url.port}` : "localhost";
    }
    return url.host;
  } catch {
    return baseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "");
  }
}

function normalizeDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).host || undefined;
  } catch {
    return trimmed
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, "")
      .trim();
  }
}

function normalizeUri(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function getSessionTokenHeader(headers: Headers): string | null {
  for (const header of SESSION_TOKEN_HEADERS) {
    const value = headers.get(header);
    if (value) return value;
  }
  return null;
}

export async function fetchPortalAccount(
  fetchImpl: typeof fetch,
  baseUrl: string,
  sessionToken: string,
): Promise<PortalAccountResponse | null> {
  const response = await fetchImpl(joinUrl(baseUrl, "/v1/account"), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (!response.ok) return null;
  return (await response
    .json()
    .catch(() => null)) as PortalAccountResponse | null;
}

export async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    throw new Error(
      `${label} failed: HTTP ${response.status} ${await safeResponseText(
        response,
      )}`,
    );
  }
  return (await response.json()) as T;
}

export function parseExpiresAt(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text ? `- ${text}` : "";
}
