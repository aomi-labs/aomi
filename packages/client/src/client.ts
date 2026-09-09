import type {
  AomiAccountProfile,
  AomiAccountResponse,
  AomiAuthPurpose,
  AomiAuthWalletFamily,
  AomiAppDescriptor,
  AomiBeginAccountAuthResponse,
  AomiClientOptions,
  AomiClearSecretsResponse,
  AomiDeleteByokKeyResponse,
  AomiDeleteSecretResponse,
  AomiIngestSecretsResponse,
  AomiListByokKeysResponse,
  AomiListSecretsResponse,
  AomiRequestOptions,
  AomiByokKeyEntry,
  AomiSaveByokKeyResponse,
  AomiSimulateResponse,
  GetAccountBearer,
  Logger,
  AomiHttpMethod,
  AomiPlatformFilter,
  ApplicationId,
} from "./types";
import { normalizeAppDescriptor } from "./app-descriptor";
import { UserState } from "./user-state";
import { AgentTransport } from "./agent/transport";
import { PipelineTransport } from "./pipeline/transport";
import { AccountTransport } from "./account/credits";
import type {
  AomiOAuthTokenProvider,
  AomiOAuthResource,
} from "./authorization";
import {
  createGuestSessionProvider,
  type GuestSessionProvider,
} from "./guest-auth";
import { wrapFetchWithPaymentChallenges } from "./payment";

// =============================================================================
// Internal helpers
// =============================================================================

const SESSION_ID_HEADER = "X-Session-Id";
// Non-Agent control endpoints still identify their owning session with both
// headers. Agent v1 carries the session id in its resource path.
const THREAD_ID_HEADER = "X-Thread-Id";
const APP_KEY_HEADER = "Aomi-App-Key";

function joinApiPath(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl === "/" ? "" : baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}` || normalizedPath;
}

type ApiQueryValue = string | readonly string[] | undefined;

// Every session-scoped request of a hosted-app thread carries application_id
// (discovery and polls included): the edge routes on it to a backend that
// holds the app's artifact.
function applicationIdParam(id: ApplicationId | undefined): string | undefined {
  return id?.toString().trim() || undefined;
}

function buildApiUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, ApiQueryValue>,
): string {
  const url = joinApiPath(baseUrl, path);
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      params.set(key, value);
    } else {
      for (const item of value) {
        params.append(key, item);
      }
    }
  }

  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function normalizeQuery(
  query: AomiRequestOptions["query"],
): Record<string, ApiQueryValue> | undefined {
  if (!query) return undefined;
  const normalized: Record<string, ApiQueryValue> = {};
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item));
      continue;
    }
    normalized[key] =
      value === null || value === undefined ? undefined : String(value);
  }
  return normalized;
}

function normalizePlatformFilter(platforms: AomiPlatformFilter): string[] {
  const rawValues = Array.isArray(platforms)
    ? platforms
    : platforms === null || platforms === undefined
      ? []
      : [platforms];

  return Array.from(
    new Set(
      rawValues
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function encodeJsonBody(body: unknown): BodyInit | undefined {
  return body === undefined ? undefined : JSON.stringify(body);
}

function withSessionHeader(sessionId: string, init?: HeadersInit): HeadersInit {
  const headers = new Headers(init);
  headers.set(SESSION_ID_HEADER, sessionId);
  headers.set(THREAD_ID_HEADER, sessionId);
  return headers;
}

export function wrapFetchWithAccountBearer(
  fetchImpl: typeof fetch,
  getAccountBearer?: GetAccountBearer,
): typeof fetch {
  if (!getAccountBearer) return fetchImpl;

  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const path = new URL(String(request?.url ?? input), "http://localhost")
      .pathname;
    if (path.startsWith("/v1/agent/") || path.startsWith("/v1/pipeline/")) {
      return fetchImpl(request ? request.clone() : input, init);
    }
    const baseHeaders = new Headers(init?.headers ?? request?.headers);
    const fetchWithBearer = async (forceRefresh: boolean) => {
      const headers = new Headers(baseHeaders);
      // The account bearer is additive — never let a failing source break the
      // request. A throwing/absent bearer just means no Authorization header.
      let bearer: string | null | undefined;
      try {
        bearer = await getAccountBearer({ forceRefresh });
      } catch (error) {
        if (getAccountBearer.required) {
          throw error;
        }
        bearer = undefined;
      }
      if (bearer) {
        headers.set("Authorization", `Bearer ${bearer}`);
      }
      // A Request body is single-use: hand fetch a clone so the 401 retry
      // below can still send the original body.
      return fetchImpl(request ? request.clone() : input, { ...init, headers });
    };

    const response = await fetchWithBearer(false);
    if (response.status !== 401) return response;
    return fetchWithBearer(true);
  };
}

export function wrapFetchWithPublicApiAuthorization(input: {
  fetch: typeof fetch;
  baseUrl: string;
  oauth?: AomiOAuthTokenProvider;
  guest?: GuestSessionProvider;
}): typeof fetch {
  if (!input.oauth && !input.guest) return input.fetch;
  return async (requestInput, init) => {
    const request = requestInput instanceof Request ? requestInput : undefined;
    const url = new URL(
      String(request?.url ?? requestInput),
      absoluteBase(input.baseUrl),
    );
    const policy = publicApiPolicy(
      url,
      init?.method ?? request?.method ?? "GET",
      init?.headers ?? request?.headers,
    );
    if (!policy) return input.fetch(requestInput, init);
    const baseHeaders = new Headers(init?.headers ?? request?.headers);
    const attempt = async (forceRefresh: boolean, dpopNonce?: string) => {
      const headers = new Headers(baseHeaders);
      if (input.oauth) {
        const token = await input.oauth({
          resource: policy.resource,
          scopes: policy.scopes,
          forceRefresh,
        });
        if (!token)
          throw new Error(
            "No OAuth grant covers this Aomi resource and scope set",
          );
        const tokenType = token.tokenType ?? "Bearer";
        headers.set("authorization", `${tokenType} ${token.accessToken}`);
        if (tokenType === "DPoP") {
          if (!token.dpopProof) {
            throw new Error("DPoP token provider returned no proof signer");
          }
          headers.set(
            "dpop",
            await token.dpopProof({
              url: url.toString(),
              method: policy.method,
              accessToken: token.accessToken,
              nonce: dpopNonce,
            }),
          );
        }
      } else if (input.guest) {
        const credential = await input.guest({ forceRefresh });
        if (credential) headers.set("authorization", `Bearer ${credential}`);
      }
      return input.fetch(request ? request.clone() : requestInput, {
        ...init,
        headers,
      });
    };
    const response = await attempt(false);
    if (response.status !== 401 && response.status !== 403) return response;
    if (input.guest && response.status === 403) return response;
    const dpopNonce = response.headers.get("dpop-nonce") ?? undefined;
    return attempt(!dpopNonce, dpopNonce);
  };
}

function publicApiPolicy(url: URL, method: string, headers?: HeadersInit) {
  const origin = url.origin;
  const payment = new Headers(headers).has("payment-signature")
    ? ["payments:submit"]
    : [];
  if (url.pathname === "/v1/agent" || url.pathname.startsWith("/v1/agent/")) {
    const scopes =
      method === "GET"
        ? ["agent:read"]
        : /\/actions\/[^/]+\/result$/.test(url.pathname)
          ? ["agent:actions:resolve"]
          : ["agent:write"];
    return {
      resource: `${origin}/v1/agent` as AomiOAuthResource,
      scopes: [...scopes, ...payment],
      method: method.toUpperCase(),
    };
  }
  if (
    url.pathname === "/v1/pipeline" ||
    url.pathname.startsWith("/v1/pipeline/")
  ) {
    return {
      resource: `${origin}/v1/pipeline` as AomiOAuthResource,
      scopes: [
        method === "GET" ? "pipeline:catalog" : "pipeline:execute",
        ...payment,
      ],
      method: method.toUpperCase(),
    };
  }
  if (
    url.pathname === "/v1/account" ||
    url.pathname.startsWith("/v1/account/")
  ) {
    const scope =
      url.pathname === "/v1/account/statement"
        ? "account:usage:read"
        : url.pathname === "/v1/account/credits/top-up"
          ? "account:credits:topup"
          : "account:credits:read";
    return {
      resource: `${origin}/v1/account` as AomiOAuthResource,
      scopes: [scope, ...payment],
      method: method.toUpperCase(),
    };
  }
  return null;
}

function absoluteBase(baseUrl: string): string {
  if (/^https?:\/\//.test(baseUrl)) return baseUrl;
  if (typeof location !== "undefined")
    return new URL(baseUrl, location.origin).toString();
  return "http://localhost";
}

// =============================================================================
// AomiClient
// =============================================================================

/**
 * Read secret names out of a {@link AomiListSecretsResponse} whichever shape
 * the backend sent.
 *
 * A backend from before per-user app secrets were retired answers
 * `{ by_app: { <app>: [names] } }`; the one after answers `{ names: [...] }`
 * (plus an empty `by_app` for one release). This client ships ahead of the
 * backend, so it has to read both — and a browser tab cached across the
 * cutover will hit each of them in turn.
 */
export function secretNamesFrom(response: AomiListSecretsResponse): string[] {
  if (response.names) return response.names;
  return Object.values(response.by_app ?? {}).flat();
}

export class AomiClient {
  readonly agent: AgentTransport;
  readonly pipeline: PipelineTransport;
  readonly account: AccountTransport;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly rawFetchImpl: typeof fetch;
  private readonly logger?: Logger;
  private readonly hasAccountAuth: boolean;

  constructor(options: AomiClientOptions) {
    // Strip trailing slash
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.hasAccountAuth = Boolean(options.getAccountBearer || options.oauth);
    this.apiKey = options.apiKey;
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    // Keep the caller's fetch implementation for tests and browser adapters;
    // `raw` only bypasses the payment wrapper, it must not bypass auth or the
    // configured transport itself.
    const rawFetchImpl = fetchImpl;
    const guest =
      options.oauth ||
      options.guest === false ||
      (options.getAccountBearer && options.guest === undefined)
        ? undefined
        : typeof options.guest === "function"
          ? options.guest
          : createGuestSessionProvider({
              baseUrl: this.baseUrl,
              fetch: fetchImpl,
            });
    const authenticatedFetch = wrapFetchWithAccountBearer(
      wrapFetchWithPublicApiAuthorization({
        fetch: fetchImpl,
        baseUrl: this.baseUrl,
        oauth: options.oauth,
        guest,
      }),
      options.getAccountBearer,
    );
    const authenticatedRawFetch = wrapFetchWithAccountBearer(
      wrapFetchWithPublicApiAuthorization({
        fetch: rawFetchImpl,
        baseUrl: this.baseUrl,
        oauth: options.oauth,
        guest,
      }),
      options.getAccountBearer,
    );
    this.fetchImpl = options.x402
      ? wrapFetchWithPaymentChallenges(authenticatedFetch, options.x402)
      : authenticatedFetch;
    // Raw requests are used for recovery probes. Re-wrapping them in x402
    // would create a fresh proof for an idempotency key whose original proof
    // may already have settled.
    this.rawFetchImpl = authenticatedRawFetch;
    this.logger = options.logger;
    this.agent = new AgentTransport(
      (method, path, requestOptions) =>
        this.requestResponse(method, path, requestOptions),
      options.inferenceFunding,
    );
    this.pipeline = new PipelineTransport((method, path, requestOptions) =>
      this.requestResponse(method, path, requestOptions),
    );
    this.account = new AccountTransport((method, path, requestOptions) =>
      this.requestResponse(method, path, requestOptions),
    );
  }

  // ===========================================================================
  // Transport
  // ===========================================================================

  /**
   * Low-level request escape hatch for the full backend route manifest.
   * Prefer the typed helpers below for common chat/session/account flows.
   */
  async request<T = unknown>(
    method: AomiHttpMethod,
    path: string,
    options?: AomiRequestOptions,
  ): Promise<T> {
    const response = await this.requestResponse(method, path, options);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${body ? `\n${body}` : ""}`,
      );
    }
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    return (
      contentType.includes("application/json")
        ? await response.json()
        : await response.text()
    ) as T;
  }

  /** Raw authenticated response transport shared by JSON, SSE, and MCP clients. */
  async requestResponse(
    method: AomiHttpMethod,
    path: string,
    options?: AomiRequestOptions,
  ): Promise<Response> {
    const url = buildApiUrl(this.baseUrl, path, normalizeQuery(options?.query));
    const headers = new Headers(options?.headers);
    if (options?.sessionId) {
      headers.set(SESSION_ID_HEADER, options.sessionId);
      headers.set(THREAD_ID_HEADER, options.sessionId);
    }
    const apiKey = options?.apiKey ?? this.apiKey;
    if (apiKey) {
      headers.set(APP_KEY_HEADER, apiKey);
    }
    if (options?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await (options?.raw ? this.rawFetchImpl : this.fetchImpl)(
      url,
      {
        method,
        headers,
        body: encodeJsonBody(options?.body),
      },
    );

    return response;
  }

  // ===========================================================================
  // Secrets
  // ===========================================================================

  /**
   * Ingest client-scoped secrets. Returns opaque `$SECRET:<name>` handles.
   *
   * There is no app scope. A hosted app's Environment belongs to its Builder
   * and is configured in Aomi Build; a per-user copy of it was a second,
   * process-local store that answered the same handle differently depending on
   * which fleet host served the turn. The backend answers 410 to any request
   * that still carries one.
   */
  async ingestSecrets(
    sessionId: string,
    clientId: string,
    secrets: Record<string, string>,
  ): Promise<AomiIngestSecretsResponse> {
    const url = joinApiPath(this.baseUrl, "/api/secrets");
    const body: {
      client_id: string;
      secrets: Record<string, string>;
    } = {
      client_id: clientId,
      secrets,
    };
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: withSessionHeader(sessionId, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as AomiIngestSecretsResponse;
  }

  /** Clear every client-scoped secret and unbind the session. */
  async clearSecrets(
    sessionId: string,
    clientId: string,
  ): Promise<AomiClearSecretsResponse> {
    const url = buildApiUrl(this.baseUrl, "/api/secrets", {
      client_id: clientId,
    });
    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers: withSessionHeader(sessionId),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as AomiClearSecretsResponse;
  }

  /** Remove a single named client-scoped secret. */
  async deleteSecret(
    sessionId: string,
    clientId: string,
    name: string,
  ): Promise<AomiDeleteSecretResponse> {
    const params: Record<string, string> = { client_id: clientId };
    const url = buildApiUrl(
      this.baseUrl,
      `/api/secrets/${encodeURIComponent(name)}`,
      params,
    );
    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers: withSessionHeader(sessionId),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as AomiDeleteSecretResponse;
  }

  /**
   * List the stored secret NAMES for this client — never values.
   *
   * Read the result with {@link secretNamesFrom}, which tolerates the
   * pre-cutover `by_app` shape as well as the flat `names` list.
   */
  async listSecrets(
    sessionId: string,
    clientId?: string,
  ): Promise<AomiListSecretsResponse> {
    // Pass the client_id explicitly so the read resolves the vault by the key
    // the caller already holds, not via the in-memory session→client_id binding
    // (which is lost on a backend restart, leaving cold reads empty).
    const url =
      clientId && clientId.trim().length > 0
        ? buildApiUrl(this.baseUrl, "/api/secrets", { client_id: clientId })
        : joinApiPath(this.baseUrl, "/api/secrets");
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: withSessionHeader(sessionId),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as AomiListSecretsResponse;
  }

  // ===========================================================================
  // Control API
  // ===========================================================================

  /**
   * Get available apps as full descriptors (name + declared secret slots).
   * The settings page consumes the slot info to render per-app inputs and
   * the chat shell uses it to gate app load when required slots are unfilled.
   */
  async getApps(
    sessionId: string,
    options?: {
      apiKey?: string;
      platforms?: AomiPlatformFilter;
      applicationId?: ApplicationId;
    },
  ): Promise<AomiAppDescriptor[]> {
    const platforms = normalizePlatformFilter(options?.platforms);
    const url = buildApiUrl(this.baseUrl, "/api/thread/apps", {
      platform: platforms.length > 0 ? platforms : undefined,
      application_id: applicationIdParam(options?.applicationId),
    });

    const apiKey = options?.apiKey ?? this.apiKey;
    const headers = new Headers(withSessionHeader(sessionId));
    if (apiKey) {
      headers.set(APP_KEY_HEADER, apiKey);
    }

    const response = await this.rawFetchImpl(url, { headers });

    if (!response.ok) {
      throw new Error(`Failed to get apps: HTTP ${response.status}`);
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => normalizeAppDescriptor(item))
      .filter((item): item is AomiAppDescriptor => item !== null);
  }

  /**
   * Fetch the account bound to the authenticated request (resolved from the
   * account bearer). Returns `null` when the session is not bound to a real
   * user — the backend answers `/api/account` with HTTP 400 for
   * anonymous sessions, which is the normal "no bearer / not logged in" case
   * rather than an error.
   */
  async fetchAccountProfile(
    sessionId: string,
  ): Promise<AomiAccountProfile | null> {
    const url = buildApiUrl(this.baseUrl, "/api/account");
    const response = await this.rawFetchImpl(url, {
      headers: withSessionHeader(sessionId),
    });

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      return null;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch account profile: HTTP ${response.status}`,
      );
    }

    return (await response.json()) as AomiAccountProfile;
  }

  /** Re-read policy on each new preparation; mode changes and revocations
   * must not be hidden behind a session-long account cache.
   */
  async prepareUserState(
    sessionId: string,
    state: UserState,
  ): Promise<UserState> {
    if (!this.hasAccountAuth || (!state.evm?.address && !state.svm?.address))
      return state;
    const profile = await this.fetchAccountProfile(sessionId);
    return profile ? UserState.route(state, profile) : state;
  }

  /**
   * Fetch the full account for the authenticated request. Throws on any
   * non-OK response; use `fetchAccountProfile` for the null-on-anonymous
   * variant.
   */
  async getAccount(sessionId: string): Promise<AomiAccountResponse> {
    const url = buildApiUrl(this.baseUrl, "/api/account");
    const response = await this.fetchImpl(url, {
      headers: withSessionHeader(sessionId),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch account: HTTP ${response.status}`);
    }

    return (await response.json()) as AomiAccountResponse;
  }

  /**
   * Mint a Privy browser auth URL bound to the current backend session.
   */
  async beginPrivyAuth(
    sessionId: string,
    options?: {
      application?: string;
      walletFamily?: AomiAuthWalletFamily;
      purpose?: AomiAuthPurpose;
    },
  ): Promise<AomiBeginAccountAuthResponse> {
    const url = buildApiUrl(this.baseUrl, "/api/auth/privy/begin");
    const response = await this.rawFetchImpl(url, {
      method: "POST",
      headers: withSessionHeader(sessionId, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        application: options?.application,
        purpose: options?.purpose ?? "link_wallet",
        wallet_family:
          options?.walletFamily === "evm" ? undefined : options?.walletFamily,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to begin Privy auth: HTTP ${response.status}`);
    }

    return (await response.json()) as AomiBeginAccountAuthResponse;
  }

  /**
   * Start Privy's separate one-time delegated-signer consent. This is not a
   * wallet-link operation and callers should label it as enabling Auto.
   */
  async beginPrivyDelegation(
    sessionId: string,
    options?: { application?: string; walletFamily?: AomiAuthWalletFamily },
  ): Promise<AomiBeginAccountAuthResponse> {
    return this.beginPrivyAuth(sessionId, {
      ...options,
      purpose: "delegate_signing",
    });
  }

  /**
   * Get available models.
   */
  async getModels(
    sessionId: string,
    options?: { apiKey?: string; applicationId?: ApplicationId },
  ): Promise<string[]> {
    const url = buildApiUrl(this.baseUrl, "/api/thread/models", {
      application_id: applicationIdParam(options?.applicationId),
    });
    const apiKey = options?.apiKey ?? this.apiKey;
    const headers = new Headers(withSessionHeader(sessionId));
    if (apiKey) {
      headers.set(APP_KEY_HEADER, apiKey);
    }

    const response = await this.rawFetchImpl(url, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to get models: HTTP ${response.status}`);
    }

    return (await response.json()) as string[];
  }

  /**
   * Set the model for a session.
   */
  async setModel(
    sessionId: string,
    rig: string,
    options?: {
      app?: string;
      applicationId?: ApplicationId;
      apiKey?: string;
      clientId?: string;
    },
  ): Promise<{
    success: boolean;
    rig: string;
    baml: string;
    created: boolean;
  }> {
    const apiKey = options?.apiKey ?? this.apiKey;
    const url = buildApiUrl(this.baseUrl, "/api/thread/model", {
      rig,
      app: options?.app,
      application_id: applicationIdParam(options?.applicationId),
      client_id: options?.clientId,
    });

    const headers = new Headers(withSessionHeader(sessionId));
    if (apiKey) {
      headers.set(APP_KEY_HEADER, apiKey);
    }

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to set model: HTTP ${response.status}`);
    }

    return (await response.json()) as {
      success: boolean;
      rig: string;
      baml: string;
      created: boolean;
    };
  }

  /**
   * List BYOK keys (one per LLM provider) bound to the current account.
   */
  async listByokKeys(sessionId: string): Promise<AomiByokKeyEntry[]> {
    const url = buildApiUrl(this.baseUrl, "/api/account/model-keys");
    const response = await this.fetchImpl(url, {
      headers: withSessionHeader(sessionId),
    });

    if (!response.ok) {
      throw new Error(`Failed to get BYOK keys: HTTP ${response.status}`);
    }

    const data = (await response.json()) as AomiListByokKeysResponse;
    return data.keys ?? [];
  }

  /**
   * Save or replace a BYOK key for the current account.
   */
  async saveByokKey(
    sessionId: string,
    provider: string,
    byokKey: string,
    label?: string,
  ): Promise<AomiByokKeyEntry> {
    const url = joinApiPath(this.baseUrl, "/api/account/model-keys");
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: withSessionHeader(sessionId, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        provider,
        byok_key: byokKey,
        label,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to save BYOK key: HTTP ${response.status}`);
    }

    const data = (await response.json()) as AomiSaveByokKeyResponse;
    return data.key;
  }

  /**
   * Delete a BYOK key for the current account.
   */
  async deleteByokKey(sessionId: string, provider: string): Promise<boolean> {
    const url = buildApiUrl(
      this.baseUrl,
      `/api/account/model-keys/${encodeURIComponent(provider)}`,
    );
    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers: withSessionHeader(sessionId),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete BYOK key: HTTP ${response.status}`);
    }

    const data = (await response.json()) as AomiDeleteByokKeyResponse;
    return data.deleted;
  }

  // ===========================================================================
  // Batch Simulation
  // ===========================================================================

  /**
   * Simulate transactions as an atomic batch.
   * Each tx sees state changes from previous txs (e.g., approve → swap).
   * Sends full tx payloads — the backend does not look up by ID.
   */
  async simulateBatch(
    sessionId: string,
    transactions: Array<{
      to: string;
      value?: string;
      data?: string;
      label?: string;
      chain_id?: number;
      chainId?: number;
    }>,
    options?: { from?: string; chainId?: number },
  ): Promise<AomiSimulateResponse> {
    const url = joinApiPath(this.baseUrl, "/api/exec/simulate");
    const headers = new Headers(
      withSessionHeader(sessionId, { "Content-Type": "application/json" }),
    );
    if (this.apiKey) {
      headers.set(APP_KEY_HEADER, this.apiKey);
    }

    const normalizedTransactions = transactions.map((transaction) => ({
      to: transaction.to,
      value: transaction.value,
      data: transaction.data,
      label: transaction.label,
      chain_id: transaction.chain_id ?? transaction.chainId ?? options?.chainId,
    }));

    const payload = {
      transactions: normalizedTransactions,
      from: options?.from,
      chain_id: options?.chainId,
    };

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${body ? `\n${body}` : ""}`,
      );
    }

    return (await response.json()) as AomiSimulateResponse;
  }
}
