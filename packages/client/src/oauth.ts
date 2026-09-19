import {
  AomiOAuthError,
  createAomiOAuthGrantManager,
  type AomiOAuthGrant,
  type AomiOAuthGrantManager,
  type AomiOAuthGrantStore,
  type AomiOAuthResource,
  type AomiOAuthTokenRequest,
} from "./authorization";
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type AomiAuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  device_authorization_endpoint: string;
  jwks_uri: string;
  code_challenge_methods_supported?: readonly string[];
};

export type AomiDeviceVerification = {
  verificationUri: string;
  verificationUriComplete?: string;
  userCode: string;
  expiresAt: number;
};

export type AomiBrowserGrantOptions = {
  portalBaseUrl: string;
  clientId: string;
  redirectUri: string;
  getWidgetBearer: () => Promise<string | null | undefined>;
  subject?: string;
  store?: AomiOAuthGrantStore;
  fetch?: typeof fetch;
  popup?: (url: string, target: string, features: string) => Window | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};

export async function discoverAomiAuthorizationServer(input: {
  portalBaseUrl: string;
  fetch?: typeof fetch;
}): Promise<AomiAuthorizationServerMetadata> {
  const fetchImpl = input.fetch ?? fetch;
  const portal = normalizedPortal(input.portalBaseUrl);
  const response = await fetchImpl(
    new URL("/.well-known/oauth-authorization-server", portal),
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) {
    throw new AomiOAuthError(
      "discovery_failed",
      `OAuth discovery failed: HTTP ${response.status}`,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  const metadata = {
    issuer: requiredUrl(body.issuer, "issuer"),
    authorization_endpoint: requiredUrl(
      body.authorization_endpoint,
      "authorization_endpoint",
    ),
    token_endpoint: requiredUrl(body.token_endpoint, "token_endpoint"),
    revocation_endpoint: requiredUrl(
      body.revocation_endpoint,
      "revocation_endpoint",
    ),
    device_authorization_endpoint: requiredUrl(
      body.device_authorization_endpoint,
      "device_authorization_endpoint",
    ),
    jwks_uri: requiredUrl(body.jwks_uri, "jwks_uri"),
    code_challenge_methods_supported: stringArray(
      body.code_challenge_methods_supported,
    ),
  } satisfies AomiAuthorizationServerMetadata;
  if (new URL(metadata.issuer).origin !== portal.origin) {
    throw new AomiOAuthError(
      "invalid_issuer",
      "Discovered OAuth issuer is not hosted by the configured Portal",
    );
  }
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.revocation_endpoint,
    metadata.device_authorization_endpoint,
    metadata.jwks_uri,
  ]) {
    if (new URL(endpoint).origin !== portal.origin) {
      throw new AomiOAuthError(
        "invalid_metadata",
        "OAuth endpoint origin does not match the configured Portal",
      );
    }
  }
  return metadata;
}

export async function createAomiDeviceGrantManager(input: {
  portalBaseUrl: string;
  clientId: string;
  subject?: string;
  store?: AomiOAuthGrantStore;
  initial?: readonly AomiOAuthGrant[];
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void | Promise<void>;
  onVerification: (
    verification: AomiDeviceVerification,
  ) => void | Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}): Promise<
  AomiOAuthGrantManager & { metadata: AomiAuthorizationServerMetadata }
> {
  if (!input.clientId.trim()) {
    throw new AomiOAuthError(
      "invalid_client",
      "A static OAuth client ID is required",
    );
  }
  const fetchImpl = input.fetch ?? fetch;
  const metadata = await discoverAomiAuthorizationServer({
    portalBaseUrl: input.portalBaseUrl,
    fetch: fetchImpl,
  });
  const manager = createAomiOAuthGrantManager({
    issuer: metadata.issuer,
    clientId: input.clientId,
    subject: input.subject,
    initial: input.initial,
    store: input.store,
    now: input.now,
    acquire: (request) =>
      acquireAomiDeviceGrant({
        metadata,
        clientId: input.clientId,
        subject: input.subject,
        request,
        fetch: fetchImpl,
        openBrowser: input.openBrowser,
        onVerification: input.onVerification,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        now: input.now,
      }),
    refresh: (grant, request) =>
      refreshAomiOAuthGrant({
        metadata,
        grant,
        request,
        fetch: fetchImpl,
        now: input.now,
      }),
    revoke: (grant) =>
      revokeAomiOAuthGrant({ metadata, grant, fetch: fetchImpl }),
  });
  return Object.assign(manager, { metadata });
}

/** Browser public-client authorization-code + PKCE flow. The popup carries no
 * bearer or bootstrap ticket in its URL; it receives the opaque ticket over an
 * exact-origin/source postMessage channel. REST tokens are DPoP-bound with an
 * extractable=false Web Crypto key kept only in this manager's memory. */
export async function createAomiBrowserGrantManager(
  input: AomiBrowserGrantOptions,
): Promise<
  AomiOAuthGrantManager & { metadata: AomiAuthorizationServerMetadata }
> {
  if (typeof window === "undefined") {
    throw new AomiOAuthError(
      "browser_required",
      "Browser OAuth requires a Window context",
    );
  }
  const fetchImpl = input.fetch ?? fetch;
  const metadata = await discoverAomiAuthorizationServer({
    portalBaseUrl: input.portalBaseUrl,
    fetch: fetchImpl,
  });
  const dpopByResource = new Map<
    string,
    Awaited<ReturnType<typeof createDpopSigner>>
  >();
  const manager = createAomiOAuthGrantManager({
    issuer: metadata.issuer,
    clientId: input.clientId,
    subject: input.subject,
    store: input.store,
    now: input.now,
    acquire: async (request) => {
      const signer = await createDpopSigner();
      const grant = await acquireAomiBrowserGrant({
        ...input,
        metadata,
        request,
        fetch: fetchImpl,
        dpopProof: signer.proof,
      });
      dpopByResource.set(request.resource, signer);
      return grant;
    },
    refresh: async (grant, request) => {
      const signer = dpopByResource.get(grant.resource);
      if (!signer) {
        throw new AomiOAuthError(
          "invalid_grant",
          "The in-memory DPoP key for this browser grant is unavailable",
        );
      }
      return refreshAomiOAuthGrant({
        metadata,
        grant,
        request,
        fetch: fetchImpl,
        now: input.now,
        dpopProof: signer.proof,
      });
    },
    revoke: (grant) =>
      revokeAomiOAuthGrant({ metadata, grant, fetch: fetchImpl }),
  });
  return Object.assign(manager, { metadata });
}

export async function acquireAomiBrowserGrant(
  input: AomiBrowserGrantOptions & {
    metadata: AomiAuthorizationServerMetadata;
    request: AomiOAuthTokenRequest;
    dpopProof: NonNullable<AomiOAuthGrant["dpopProof"]>;
  },
): Promise<AomiOAuthGrant> {
  assertOneResource(input.request.resource);
  if (!input.clientId.trim()) {
    throw new AomiOAuthError(
      "invalid_client",
      "A static OAuth client ID is required",
    );
  }
  if (!input.metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new AomiOAuthError(
      "invalid_metadata",
      "OAuth server does not advertise PKCE S256",
    );
  }
  const portal = normalizedPortal(input.portalBaseUrl);
  const redirect = new URL(input.redirectUri);
  if (redirect.origin !== window.location.origin) {
    throw new AomiOAuthError(
      "invalid_redirect_uri",
      "Browser OAuth redirect URI must use the embedding page origin",
    );
  }
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(32);
  const codeChallenge = await sha256Base64Url(verifier);
  const popupUrl = new URL("/oauth/bootstrap", portal);
  popupUrl.searchParams.set("origin", window.location.origin);
  const popup = (input.popup ?? window.open)(
    popupUrl.toString(),
    "aomi-oauth",
    "popup,width=520,height=720,resizable=yes,scrollbars=yes",
  );
  if (!popup)
    throw new AomiOAuthError("popup_blocked", "OAuth popup was blocked");

  try {
    const ready = await waitForPopupReady({
      popup,
      portalOrigin: portal.origin,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    });
    const widgetBearer = await input.getWidgetBearer();
    if (!widgetBearer) {
      throw new AomiOAuthError(
        "widget_session_required",
        "An authenticated widget session is required",
      );
    }
    const ticketResponse = await (input.fetch ?? fetch)(
      new URL("/api/auth/widget/oauth-bootstrap", portal),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${widgetBearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: input.clientId,
          redirect_uri: redirect.toString(),
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          resource: input.request.resource,
          scope: input.request.scopes.join(" "),
          state,
          channel_nonce: ready.channelNonce,
        }),
        signal: input.signal,
      },
    );
    const ticketBody = await jsonRecord(ticketResponse);
    if (!ticketResponse.ok) {
      throw oauthResponseError("bootstrap_ticket_failed", ticketBody);
    }
    popup.postMessage(
      {
        type: "aomi.oauth.bootstrap.ticket",
        origin: window.location.origin,
        ticket: requiredString(ticketBody.ticket, "ticket"),
        state,
        clientId: input.clientId,
        resource: input.request.resource,
        scopes: [...input.request.scopes],
      },
      portal.origin,
    );

    const callback = await waitForPopupCallback({
      popup,
      redirectUri: redirect.toString(),
      state,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    });
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: redirect.toString(),
      client_id: input.clientId,
      code_verifier: verifier,
      resource: input.request.resource,
    });
    const tokenResponse = await fetchTokenWithDpopNonce({
      fetch: input.fetch ?? fetch,
      endpoint: input.metadata.token_endpoint,
      params: tokenParams,
      proof: input.dpopProof,
      signal: input.signal,
    });
    const tokenBody = await jsonRecord(tokenResponse);
    if (!tokenResponse.ok) throw oauthResponseError("token_error", tokenBody);
    return {
      ...tokenGrant({
        body: tokenBody,
        issuer: input.metadata.issuer,
        clientId: input.clientId,
        subject: input.subject,
        resource: input.request.resource,
        scopes: input.request.scopes,
        now: input.now ?? Date.now,
      }),
      tokenType: "DPoP",
      dpopProof: input.dpopProof,
    };
  } finally {
    if (!popup.closed) popup.close();
  }
}

export async function acquireAomiDeviceGrant(input: {
  metadata: AomiAuthorizationServerMetadata;
  clientId: string;
  subject?: string;
  request: AomiOAuthTokenRequest;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void | Promise<void>;
  onVerification: (
    verification: AomiDeviceVerification,
  ) => void | Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}): Promise<AomiOAuthGrant> {
  const fetchImpl = input.fetch ?? fetch;
  const now = input.now ?? Date.now;
  assertOneResource(input.request.resource);
  const codeResponse = await fetchImpl(
    input.metadata.device_authorization_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        scope: input.request.scopes.join(" "),
        resource: input.request.resource,
      }),
      signal: input.signal,
    },
  );
  const code = await jsonRecord(codeResponse);
  if (!codeResponse.ok)
    throw oauthResponseError("device_authorization_failed", code);
  const deviceCode = requiredString(code.device_code, "device_code");
  const userCode = requiredString(code.user_code, "user_code");
  const verificationUri = requiredUrl(
    code.verification_uri,
    "verification_uri",
  );
  const verificationUriComplete = optionalUrl(code.verification_uri_complete);
  const expiresAt =
    now() + positiveNumber(code.expires_in, "expires_in") * 1000;
  await input.onVerification({
    verificationUri,
    verificationUriComplete,
    userCode,
    expiresAt,
  });
  if (input.openBrowser) {
    await input.openBrowser(verificationUriComplete ?? verificationUri);
  }

  const timeoutAt = Math.min(
    expiresAt,
    input.timeoutMs == null ? expiresAt : now() + input.timeoutMs,
  );
  let intervalMs = Math.max(Number(code.interval ?? 5), 1) * 1000;
  while (now() < timeoutAt) {
    await abortableDelay(intervalMs, input.signal);
    const response = await fetchImpl(input.metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        device_code: deviceCode,
        client_id: input.clientId,
        resource: input.request.resource,
      }),
      signal: input.signal,
    });
    const body = await jsonRecord(response);
    if (!response.ok) {
      const code = typeof body.error === "string" ? body.error : "token_error";
      if (code === "authorization_pending") continue;
      if (code === "slow_down") {
        intervalMs += 5_000;
        continue;
      }
      throw oauthResponseError(code, body);
    }
    return tokenGrant({
      body,
      issuer: input.metadata.issuer,
      clientId: input.clientId,
      subject: input.subject,
      resource: input.request.resource,
      scopes: input.request.scopes,
      now,
    });
  }
  throw new AomiOAuthError(
    now() >= expiresAt ? "expired_token" : "timeout",
    "OAuth device authorization expired before approval",
  );
}

export async function refreshAomiOAuthGrant(input: {
  metadata: AomiAuthorizationServerMetadata;
  grant: AomiOAuthGrant;
  request: AomiOAuthTokenRequest;
  fetch?: typeof fetch;
  now?: () => number;
  dpopProof?: NonNullable<AomiOAuthGrant["dpopProof"]>;
}): Promise<AomiOAuthGrant> {
  if (!input.grant.refreshToken) {
    throw new AomiOAuthError(
      "invalid_grant",
      "OAuth grant has no refresh token",
    );
  }
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.grant.refreshToken,
    client_id: input.grant.clientId,
    resource: input.grant.resource,
    scope: input.request.scopes.join(" "),
  });
  const response = input.dpopProof
    ? await fetchTokenWithDpopNonce({
        fetch: input.fetch ?? fetch,
        endpoint: input.metadata.token_endpoint,
        params,
        proof: input.dpopProof,
      })
    : await (input.fetch ?? fetch)(input.metadata.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params,
      });
  const body = await jsonRecord(response);
  if (!response.ok) throw oauthResponseError("refresh_failed", body);
  const grant = tokenGrant({
    body,
    issuer: input.grant.issuer,
    clientId: input.grant.clientId,
    subject: input.grant.subject,
    resource: input.grant.resource,
    scopes: input.grant.scopes,
    priorRefreshToken: input.grant.refreshToken,
    now: input.now ?? Date.now,
  });
  return input.dpopProof
    ? { ...grant, tokenType: "DPoP", dpopProof: input.dpopProof }
    : grant;
}

export async function revokeAomiOAuthGrant(input: {
  metadata: AomiAuthorizationServerMetadata;
  grant: AomiOAuthGrant;
  fetch?: typeof fetch;
}): Promise<void> {
  const token = input.grant.refreshToken ?? input.grant.accessToken;
  const response = await (input.fetch ?? fetch)(
    input.metadata.revocation_endpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        client_id: input.grant.clientId,
      }),
    },
  );
  if (!response.ok) {
    throw new AomiOAuthError(
      "revoke_failed",
      `OAuth revocation failed: HTTP ${response.status}`,
    );
  }
}

function tokenGrant(input: {
  body: Record<string, unknown>;
  issuer: string;
  clientId: string;
  subject?: string;
  resource: AomiOAuthResource;
  scopes: readonly string[];
  priorRefreshToken?: string;
  now: () => number;
}): AomiOAuthGrant {
  const responseScopes =
    typeof input.body.scope === "string"
      ? input.body.scope.split(/\s+/).filter(Boolean)
      : [...input.scopes];
  if (responseScopes.some((scope) => !input.scopes.includes(scope))) {
    throw new AomiOAuthError("invalid_scope", "Token response expanded scopes");
  }
  return {
    issuer: input.issuer,
    clientId: input.clientId,
    subject: input.subject,
    accessToken: requiredString(input.body.access_token, "access_token"),
    refreshToken:
      typeof input.body.refresh_token === "string"
        ? input.body.refresh_token
        : input.priorRefreshToken,
    expiresAt:
      input.now() +
      positiveNumber(input.body.expires_in ?? 300, "expires_in") * 1000,
    resource: input.resource,
    scopes: responseScopes,
    tokenType: input.body.token_type === "DPoP" ? "DPoP" : "Bearer",
  };
}

function oauthResponseError(
  fallback: string,
  body: Record<string, unknown>,
): AomiOAuthError {
  const code = typeof body.error === "string" ? body.error : fallback;
  const message =
    typeof body.error_description === "string" ? body.error_description : code;
  return new AomiOAuthError(code, message);
}

async function jsonRecord(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function normalizedPortal(value: string): URL {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function assertOneResource(resource: string): void {
  if (!/^https?:\/\//.test(resource)) {
    throw new AomiOAuthError(
      "invalid_target",
      "Aomi resource must be an absolute URL",
    );
  }
}

function requiredUrl(value: unknown, name: string): string {
  const raw = requiredString(value, name);
  return new URL(raw).toString();
}

function optionalUrl(value: unknown): string | undefined {
  return typeof value === "string" && value
    ? new URL(value).toString()
    : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new AomiOAuthError(
      "invalid_response",
      `OAuth response is missing ${name}`,
    );
  }
  return value;
}

function positiveNumber(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new AomiOAuthError(
      "invalid_response",
      `OAuth response has invalid ${name}`,
    );
  }
  return number;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function createDpopSigner(): Promise<{
  proof: NonNullable<AomiOAuthGrant["dpopProof"]>;
}> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: false,
  });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  await calculateJwkThumbprint(publicJwk, "sha256");
  return {
    proof: async ({ url, method, accessToken, nonce }) => {
      const claims: Record<string, string | number> = {
        jti: randomBase64Url(24),
        htm: method.toUpperCase(),
        htu: dpopTargetUrl(url),
        iat: Math.floor(Date.now() / 1000),
      };
      if (accessToken) claims.ath = await sha256Base64Url(accessToken);
      if (nonce) claims.nonce = nonce;
      return new SignJWT(claims)
        .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: publicJwk })
        .sign(privateKey);
    },
  };
}

async function fetchTokenWithDpopNonce(input: {
  fetch: typeof fetch;
  endpoint: string;
  params: URLSearchParams;
  proof: NonNullable<AomiOAuthGrant["dpopProof"]>;
  signal?: AbortSignal;
}): Promise<Response> {
  const attempt = async (nonce?: string) =>
    input.fetch(input.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        dpop: await input.proof({
          url: input.endpoint,
          method: "POST",
          accessToken: "",
          nonce,
        }),
      },
      body: new URLSearchParams(input.params),
      signal: input.signal,
    });
  const first = await attempt();
  const nonce = first.headers.get("dpop-nonce") ?? undefined;
  return nonce && !first.ok ? attempt(nonce) : first;
}

function waitForPopupReady(input: {
  popup: Window;
  portalOrigin: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ channelNonce: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(new AomiOAuthError("timeout", "OAuth popup timed out")),
        ),
      input.timeoutMs ?? 120_000,
    );
    const onAbort = () =>
      finish(() => reject(input.signal?.reason ?? new Error("aborted")));
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== input.popup || event.origin !== input.portalOrigin)
        return;
      const value = event.data as {
        type?: unknown;
        channelNonce?: unknown;
      } | null;
      if (
        value?.type !== "aomi.oauth.bootstrap.ready" ||
        typeof value.channelNonce !== "string" ||
        value.channelNonce.length < 16
      ) {
        return;
      }
      finish(() => resolve({ channelNonce: value.channelNonce as string }));
    };
    const finish = (done: () => void) => {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      input.signal?.removeEventListener("abort", onAbort);
      done();
    };
    window.addEventListener("message", onMessage);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
  });
}

function waitForPopupCallback(input: {
  popup: Window;
  redirectUri: string;
  state: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ code: string }> {
  const expected = new URL(input.redirectUri);
  const deadline = Date.now() + (input.timeoutMs ?? 120_000);
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearInterval(poll);
      input.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => {
      stop();
      reject(error);
    };
    const onAbort = () => fail(input.signal?.reason ?? new Error("aborted"));
    const poll = setInterval(() => {
      if (input.popup.closed) {
        fail(new AomiOAuthError("access_denied", "OAuth popup was closed"));
        return;
      }
      if (Date.now() >= deadline) {
        fail(new AomiOAuthError("timeout", "OAuth callback timed out"));
        return;
      }
      try {
        const location = new URL(input.popup.location.href);
        if (
          location.origin !== expected.origin ||
          location.pathname !== expected.pathname
        ) {
          return;
        }
        if (location.searchParams.get("state") !== input.state) {
          fail(
            new AomiOAuthError("invalid_state", "OAuth state did not match"),
          );
          return;
        }
        const error = location.searchParams.get("error");
        if (error) {
          fail(
            new AomiOAuthError(
              error,
              location.searchParams.get("error_description") ?? error,
            ),
          );
          return;
        }
        const code = location.searchParams.get("code");
        if (!code) return;
        stop();
        resolve({ code });
      } catch {
        // Cross-origin access throws until the popup reaches the registered
        // partner callback. Continue polling without weakening origin checks.
      }
    }, 250);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
  });
}

function dpopTargetUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function randomBase64Url(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return encodeBase64Url(value);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
