import {
  AomiOAuthError,
  apiResource,
  type AomiOAuthGrant,
  type AomiOAuthGrantManager,
  type AomiOAuthGrantStore,
  type AomiOAuthResource,
  type AomiOAuthTokenProvider,
} from "../authorization";
import { AomiError } from "../api-error";
import type { GuestSessionProvider } from "../guest-auth";
import { buildSiweMessage } from "../siwe";
import type { GetAccountBearer } from "../types";
import {
  createAomiBrowserGrantManager,
  createAomiDeviceGrantManager,
  type AomiDeviceVerification,
} from "../oauth";

export type AomiAuthTarget = "agent" | "pipeline";
export type AomiAuthMode =
  | "guest"
  | "oauth"
  | "wallet"
  | "session"
  | "custom"
  | "none";

export type AomiAuthStatus = {
  mode: AomiAuthMode;
  /** REST resources with a cached OAuth grant. Empty for non-OAuth modes. */
  authorized: readonly AomiAuthTarget[];
};

export type AomiAuthLoginOptions = {
  /** Acquire one exact grant per target. Defaults to Agent. */
  for?: AomiAuthTarget | readonly AomiAuthTarget[];
};

export type AomiAuthController = {
  readonly mode: AomiAuthMode;
  status(): Promise<AomiAuthStatus>;
  /**
   * Eagerly authenticate. Normal API calls also acquire or refresh OAuth
   * grants lazily, so most applications do not need to call this method.
   */
  login(options?: AomiAuthLoginOptions): Promise<AomiAuthStatus>;
  /** Revoke persisted OAuth grants when possible, then clear local state. */
  logout(): Promise<void>;
};

type CommonOAuthOptions = {
  /** Provisioned public-client ID. Never pass a client secret. */
  clientId: string;
  /**
   * More scopes to ask for at the first sign-in, besides Agent and Pipeline,
   * e.g. `account:apps:write`, so one approval covers them too.
   */
  scopes?: readonly string[];
  subject?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};

export type AomiDeviceOAuthOptions = Omit<CommonOAuthOptions, "clientId"> & {
  flow?: "device";
  /** Omit to register a public device client on first sign-in. Its id is on every grant. */
  clientId?: string;
  /** The registered client's name, shown where the person manages connections. */
  clientName?: string;
  /**
   * Device grants are Bearer grants and may be persisted by a host-provided
   * store. The default remains memory-only.
   */
  store?: AomiOAuthGrantStore;
  initial?: readonly AomiOAuthGrant[];
  openBrowser?: (url: string) => void | Promise<void>;
  /** Show the person where to approve. One of this or `onCode` is required. */
  onVerification?: (
    verification: AomiDeviceVerification,
  ) => void | Promise<void>;
  /** Show the person the page and code to approve with. */
  onCode?: (prompt: {
    url: string;
    code: string;
    expiresAt: number;
  }) => void | Promise<void>;
};

export type AomiBrowserOAuthOptions = CommonOAuthOptions & {
  flow: "browser";
  redirectUri: string;
  getWidgetBearer: () => Promise<string | null | undefined>;
  popup?: (url: string, target: string, features: string) => Window | null;
};

export type AomiOAuthStrategy = {
  readonly kind: "oauth";
  readonly options: AomiDeviceOAuthOptions | AomiBrowserOAuthOptions;
};

/**
 * Configure signed-in Aomi access once. Agent and Pipeline resource URLs,
 * scopes, acquisition, refresh, and revocation remain SDK-owned.
 */
export function oauth(
  options: AomiDeviceOAuthOptions | AomiBrowserOAuthOptions,
): AomiOAuthStrategy {
  return { kind: "oauth", options };
}

/** A token minted elsewhere, for server use: sent as-is, never refreshed. */
export type AomiBearerStrategy = {
  readonly kind: "bearer";
  readonly token: string;
};

export function bearer(token: string): AomiBearerStrategy {
  if (!token.trim()) throw new TypeError("bearer token is required");
  return { kind: "bearer", token };
}

/** Signs SIWE messages: a viem account (`privateKeyToAccount(key)`) fits. */
export type AomiWalletSigner = {
  address: string;
  signMessage(args: { message: string }): Promise<string>;
};

/** Sign in with an EVM key (SIWE), for bots and scripts. */
export type AomiWalletStrategy = {
  readonly kind: "wallet";
  readonly signer: AomiWalletSigner;
  readonly chainId: number;
};

export function wallet(
  signer: AomiWalletSigner,
  options: { chainId?: number } = {},
): AomiWalletStrategy {
  return { kind: "wallet", signer, chainId: options.chainId ?? 1 };
}

export type AomiAuthStrategy =
  | AomiOAuthStrategy
  | AomiBearerStrategy
  | AomiWalletStrategy;

type ManagedOAuth = AomiOAuthGrantManager;

export function createOAuthAuthRuntime(input: {
  baseUrl: string;
  fetch: typeof fetch;
  strategy: AomiOAuthStrategy;
}): {
  tokenProvider: AomiOAuthTokenProvider;
  controller: AomiAuthController;
} {
  const portalBaseUrl = absolutePortalBaseUrl(input.baseUrl);
  const configured = input.strategy.options;
  let managerPromise: Promise<ManagedOAuth> | undefined;

  const manager = () => {
    managerPromise ??=
      configured.flow === "browser"
        ? createAomiBrowserGrantManager({
            portalBaseUrl,
            clientId: configured.clientId,
            redirectUri: configured.redirectUri,
            getWidgetBearer: configured.getWidgetBearer,
            subject: configured.subject,
            scopes: [...SIGN_IN_SCOPES, ...(configured.scopes ?? [])],
            fetch: input.fetch,
            popup: configured.popup,
            signal: configured.signal,
            timeoutMs: configured.timeoutMs,
            now: configured.now,
          })
        : createAomiDeviceGrantManager({
            portalBaseUrl,
            clientId: configured.clientId,
            clientName: configured.clientName,
            subject: configured.subject,
            scopes: [...SIGN_IN_SCOPES, ...(configured.scopes ?? [])],
            store: configured.store,
            initial: configured.initial,
            fetch: input.fetch,
            openBrowser: configured.openBrowser,
            onVerification: async (verification) => {
              const { onVerification, onCode } = configured;
              if (onVerification) return onVerification(verification);
              if (!onCode)
                throw new TypeError("oauth() needs onCode or onVerification");
              return onCode({
                url:
                  verification.verificationUriComplete ??
                  verification.verificationUri,
                code: verification.userCode,
                expiresAt: verification.expiresAt,
              });
            },
            signal: configured.signal,
            timeoutMs: configured.timeoutMs,
            now: configured.now,
          });
    return managerPromise;
  };

  const status = async (): Promise<AomiAuthStatus> => ({
    mode: "oauth",
    authorized: authorizedTargets(
      await (await manager()).grants(),
      portalBaseUrl,
    ),
  });

  const tokenProvider: AomiOAuthTokenProvider = async (request) =>
    (await manager()).tokenProvider({
      ...request,
      scopes: [...new Set([...request.scopes, "offline_access"])],
    });

  return {
    tokenProvider,
    controller: {
      mode: "oauth",
      status,
      async login(options) {
        const targets = uniqueTargets(options?.for ?? "agent");
        // One sign-in covers every target: Agent and Pipeline share `/v1`.
        const grant = await tokenProvider({
          resource: resourceFor(portalBaseUrl, targets[0] ?? "agent"),
          scopes: [
            ...new Set(targets.flatMap((target) => AUTH_SCOPES[target])),
          ],
        });
        if (!grant) {
          throw new AomiOAuthError(
            "interaction_required",
            `OAuth did not return a grant for ${targets.join(" and ")}`,
          );
        }
        return status();
      },
      async logout() {
        const active = await manager();
        const resources = new Set(
          (await active.grants()).map((grant) => grant.resource),
        );
        const revocations = await Promise.allSettled(
          [...resources].map((resource) => active.revoke(resource)),
        );
        await active.clear();
        const failed = revocations.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failed) throw failed.reason;
      },
    },
  };
}

/**
 * A wallet sign-in: SIWE against the portal's Better Auth, once per process,
 * again after a 401. The session token is the account bearer on every route.
 */
export function createWalletAuthRuntime(input: {
  baseUrl: string;
  fetch: typeof fetch;
  strategy: AomiWalletStrategy;
}): { bearer: GetAccountBearer; controller: AomiAuthController } {
  const portal = new URL(absolutePortalBaseUrl(input.baseUrl));
  const { signer, chainId } = input.strategy;
  const post = async (path: string, body: unknown, token?: string) => {
    const response = await input.fetch(new URL(path, portal), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: portal.origin,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new AomiError(
        "wallet_sign_in_failed",
        `${path} failed: HTTP ${response.status}`,
        response.status,
      );
    return response;
  };
  const signIn = async () => {
    const { nonce } = (await (
      await post("/api/auth/siwe/nonce", {})
    ).json()) as { nonce?: string };
    if (!nonce) throw new AomiError("wallet_sign_in_failed", "No SIWE nonce");
    const message = buildSiweMessage({
      address: signer.address,
      chainId,
      nonce,
      domain: portal.host,
      uri: portal.origin,
    });
    const signature = await signer.signMessage({ message });
    const verified = await post("/api/auth/siwe/verify", {
      message,
      signature,
    });
    const token =
      verified.headers.get("set-auth-token") ??
      ((await verified.json()) as { token?: string }).token;
    if (!token)
      throw new AomiError("wallet_sign_in_failed", "No session from SIWE");
    return token;
  };
  let session: Promise<string> | undefined;
  const bearer: GetAccountBearer = Object.assign(
    ({ forceRefresh = false } = {}) => {
      if (forceRefresh || !session) {
        session = signIn();
        session.catch(() => (session = undefined));
      }
      return session;
    },
    { required: true },
  );
  const status = async (): Promise<AomiAuthStatus> => ({
    mode: "wallet",
    authorized: session ? ["agent", "pipeline"] : [],
  });
  return {
    bearer,
    controller: {
      mode: "wallet",
      status,
      async login() {
        await bearer();
        return status();
      },
      async logout() {
        const token = await session?.catch(() => undefined);
        session = undefined;
        if (token) await post("/api/auth/sign-out", {}, token);
      },
    },
  };
}

export function createGuestAuthController(
  guest: GuestSessionProvider,
): AomiAuthController {
  const status = async (): Promise<AomiAuthStatus> => ({
    mode: "guest",
    authorized: [],
  });
  return {
    mode: "guest",
    status,
    async login() {
      await guest({ forceRefresh: true });
      return status();
    },
    async logout() {
      guest.clear();
    },
  };
}

export function createPassiveAuthController(
  mode: Exclude<AomiAuthMode, "oauth" | "guest">,
): AomiAuthController {
  const status = async (): Promise<AomiAuthStatus> => ({
    mode,
    authorized: [],
  });
  return {
    mode,
    status,
    async login() {
      throw new AomiOAuthError(
        "unsupported_auth_mode",
        `Explicit login is not available for ${mode} authentication`,
      );
    },
    async logout() {},
  };
}

const AUTH_SCOPES = {
  agent: [
    "agent:read",
    "agent:write",
    "agent:actions:resolve",
    "offline_access",
  ],
  pipeline: ["pipeline:catalog", "pipeline:execute", "offline_access"],
} as const;

/** What the SDK asks for at its first sign-in: Agent and Pipeline. */
const SIGN_IN_SCOPES = [
  ...new Set([...AUTH_SCOPES.agent, ...AUTH_SCOPES.pipeline]),
];

function resourceFor(
  portalBaseUrl: string,
  target: AomiAuthTarget,
): AomiOAuthResource {
  return new URL(
    `/v1/${target}`,
    portalBaseUrl,
  ).toString() as AomiOAuthResource;
}

function uniqueTargets(
  value: AomiAuthTarget | readonly AomiAuthTarget[],
): AomiAuthTarget[] {
  return [...new Set(Array.isArray(value) ? value : [value])];
}

function authorizedTargets(
  grants: readonly AomiOAuthGrant[],
  portalBaseUrl: string,
): AomiAuthTarget[] {
  const targets = new Set<AomiAuthTarget>();
  for (const grant of grants) {
    for (const target of ["agent", "pipeline"] as const) {
      const resource = resourceFor(portalBaseUrl, target);
      // Only the `/v1` sign-in is used now; older per-resource grants aren't.
      if (
        grant.resource === apiResource(resource) &&
        grant.scopes.includes(AUTH_SCOPES[target][0])
      )
        targets.add(target);
    }
  }
  return [...targets];
}

function absolutePortalBaseUrl(value: string): string {
  if (/^https?:\/\//.test(value)) return value;
  if (typeof location !== "undefined") {
    return new URL(value, location.origin).toString();
  }
  throw new TypeError("OAuth requires an absolute Aomi baseUrl in Node.js");
}
