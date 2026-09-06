import type { AomiClient } from "./client";

export type AomiOAuthResource =
  | `${string}/v1/agent`
  | `${string}/v1/pipeline`
  | `${string}/v1/account`
  | `${string}/v1/agent/mcp`
  | `${string}/v1/pipeline/mcp`;

export type AomiOAuthTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  resource: AomiOAuthResource;
  scopes: readonly string[];
  tokenType?: "Bearer" | "DPoP";
  dpopProof?: (input: {
    url: string;
    method: string;
    accessToken: string;
    nonce?: string;
  }) => Promise<string>;
};

export type AomiOAuthTokenRequest = {
  resource: AomiOAuthResource;
  scopes: readonly string[];
  forceRefresh?: boolean;
};

export type AomiOAuthTokenProvider = (
  request: AomiOAuthTokenRequest,
) => Promise<AomiOAuthTokenSet | null>;

export type AomiOAuthGrant = AomiOAuthTokenSet & {
  issuer: string;
  clientId: string;
  subject?: string;
};

export type AomiOAuthGrantStore = {
  load(): Promise<readonly AomiOAuthGrant[]>;
  /** Replace the complete grant snapshot atomically. */
  save(grants: readonly AomiOAuthGrant[]): Promise<void>;
};

export type AomiOAuthGrantManager = {
  tokenProvider: AomiOAuthTokenProvider;
  put(grant: AomiOAuthGrant): Promise<void>;
  grants(): Promise<readonly AomiOAuthGrant[]>;
  revoke(resource: AomiOAuthResource): Promise<void>;
  clear(): Promise<void>;
};

export class AomiOAuthError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "AomiOAuthError";
  }
}

export function createMemoryOAuthGrantStore(
  initial: readonly AomiOAuthGrant[] = [],
): AomiOAuthGrantStore {
  let grants = initial.map(copyGrant);
  return {
    async load() {
      return grants.map(copyGrant);
    },
    async save(next) {
      grants = next.map(copyGrant);
    },
  };
}

/**
 * Multi-resource OAuth grant manager shared by browser, headless and CLI
 * hosts. The default store is memory-only; durable refresh-token persistence
 * exists only when a host explicitly injects a store.
 */
export function createAomiOAuthGrantManager(input: {
  issuer: string;
  clientId: string;
  subject?: string;
  initial?: readonly AomiOAuthGrant[];
  store?: AomiOAuthGrantStore;
  acquire?: (request: AomiOAuthTokenRequest) => Promise<AomiOAuthGrant | null>;
  refresh: (
    grant: AomiOAuthGrant,
    request: AomiOAuthTokenRequest,
  ) => Promise<AomiOAuthGrant>;
  revoke?: (grant: AomiOAuthGrant) => Promise<void>;
  now?: () => number;
}): AomiOAuthGrantManager {
  const issuer = normalizeIssuer(input.issuer);
  const store = input.store ?? createMemoryOAuthGrantStore(input.initial);
  const pendingRefresh = new Map<string, Promise<AomiOAuthGrant>>();
  const now = input.now ?? Date.now;
  let grants: AomiOAuthGrant[] = [];
  const ready = store.load().then((stored) => {
    const combined = [...stored, ...(input.initial ?? [])];
    grants = uniqueGrants(
      combined.filter(
        (grant) =>
          normalizeIssuer(grant.issuer) === issuer &&
          grant.clientId === input.clientId &&
          grant.subject === input.subject,
      ),
    );
  });

  async function persist() {
    await store.save(grants.map(copyGrant));
  }

  async function put(grant: AomiOAuthGrant) {
    await ready;
    assertGrantContext(grant, issuer, input.clientId, input.subject);
    const key = grantKey(grant);
    grants = [
      ...grants.filter((candidate) => grantKey(candidate) !== key),
      copyGrant(grant),
    ];
    await persist();
  }

  const tokenProvider: AomiOAuthTokenProvider = async (request) => {
    await ready;
    let grant = bestGrant(grants, request);
    if (!grant) {
      const acquired = await input.acquire?.(request);
      if (!acquired) return null;
      await put(acquired);
      grant = bestGrant(grants, request);
      if (!grant) return null;
    }
    if (!request.forceRefresh && grant.expiresAt > now() + 30_000) {
      return copyGrant(grant);
    }
    if (!grant.refreshToken) return null;
    const key = grantKey(grant);
    let pending = pendingRefresh.get(key);
    if (!pending) {
      pending = input
        .refresh(copyGrant(grant), request)
        .then(async (refreshed) => {
          assertGrantContext(refreshed, issuer, input.clientId, input.subject);
          if (
            refreshed.resource !== grant?.resource ||
            refreshed.scopes.some((scope) => !grant?.scopes.includes(scope))
          ) {
            throw new AomiOAuthError(
              "invalid_grant",
              "OAuth refresh attempted to expand its resource or scopes",
            );
          }
          grants = [
            ...grants.filter((candidate) => grantKey(candidate) !== key),
            copyGrant(refreshed),
          ];
          await persist();
          return refreshed;
        })
        .catch(async (error) => {
          if (oauthErrorCode(error) === "invalid_grant") {
            grants = grants.filter((candidate) => grantKey(candidate) !== key);
            await persist();
          }
          throw error;
        })
        .finally(() => pendingRefresh.delete(key));
      pendingRefresh.set(key, pending);
    }
    return copyGrant(await pending);
  };

  return {
    tokenProvider,
    put,
    async grants() {
      await ready;
      return grants.map(copyGrant);
    },
    async revoke(resource) {
      await ready;
      const selected = grants.filter((grant) => grant.resource === resource);
      for (const grant of selected) await input.revoke?.(copyGrant(grant));
      const keys = new Set(selected.map(grantKey));
      grants = grants.filter((grant) => !keys.has(grantKey(grant)));
      await persist();
    },
    async clear() {
      await ready;
      grants = [];
      await persist();
    },
  };
}

export function createOAuthTokenProvider(input: {
  initial?: AomiOAuthTokenSet | null;
  refresh: (
    current: AomiOAuthTokenSet,
    request: AomiOAuthTokenRequest,
  ) => Promise<AomiOAuthTokenSet>;
  now?: () => number;
}): AomiOAuthTokenProvider & {
  clear(): void;
  current(): AomiOAuthTokenSet | null;
} {
  let current = input.initial ?? null;
  let pending: Promise<AomiOAuthTokenSet> | null = null;
  const now = input.now ?? Date.now;
  const provider = async (request: AomiOAuthTokenRequest) => {
    const matches =
      current?.resource === request.resource &&
      request.scopes.every((scope) => current?.scopes.includes(scope));
    if (
      current &&
      matches &&
      !request.forceRefresh &&
      current.expiresAt > now() + 30_000
    ) {
      return current;
    }
    if (!current || !matches) return null;
    pending ??= input.refresh(current, request).finally(() => {
      pending = null;
    });
    current = await pending;
    return current;
  };
  return Object.assign(provider, {
    clear() {
      current = null;
    },
    current: () => current,
  });
}

function bestGrant(
  grants: readonly AomiOAuthGrant[],
  request: AomiOAuthTokenRequest,
): AomiOAuthGrant | null {
  return (
    grants
      .filter(
        (grant) =>
          grant.resource === request.resource &&
          request.scopes.every((scope) => grant.scopes.includes(scope)),
      )
      .sort((left, right) => left.scopes.length - right.scopes.length)[0] ??
    null
  );
}

function grantKey(grant: AomiOAuthGrant): string {
  return [
    normalizeIssuer(grant.issuer),
    grant.clientId,
    grant.subject ?? "",
    grant.resource,
    [...new Set(grant.scopes)].sort().join(" "),
  ].join("\u0000");
}

function uniqueGrants(grants: readonly AomiOAuthGrant[]): AomiOAuthGrant[] {
  const byKey = new Map<string, AomiOAuthGrant>();
  for (const grant of grants) byKey.set(grantKey(grant), copyGrant(grant));
  return [...byKey.values()];
}

function copyGrant<T extends AomiOAuthTokenSet>(grant: T): T {
  return { ...grant, scopes: [...grant.scopes] };
}

function assertGrantContext(
  grant: AomiOAuthGrant,
  issuer: string,
  clientId: string,
  subject: string | undefined,
) {
  if (
    normalizeIssuer(grant.issuer) !== issuer ||
    grant.clientId !== clientId ||
    grant.subject !== subject
  ) {
    throw new AomiOAuthError(
      "invalid_grant",
      "OAuth grant does not belong to this issuer, client, and subject",
    );
  }
}

function normalizeIssuer(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function oauthErrorCode(error: unknown): string | null {
  if (error instanceof AomiOAuthError) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : null;
  }
  return null;
}

export type AuthorizationPoster = <T>(
  path: string,
  body: unknown,
) => Promise<T>;

export type AomiAuthorizationPermit = {
  account: string;
  chain_type: string;
  wallet: string;
  mode: string;
  version: number;
  expiry: number;
};

export type AomiAuthorizationChallenge = {
  permit: AomiAuthorizationPermit;
  typed_data?: unknown;
  message_base64?: string;
};

export type AomiAuthorizationState = {
  address: string;
  chain_type: string;
  signing_mode: string;
  authorization_version: number;
};

export type AomiEnsureBoundResult =
  | { status: "bound"; state: AomiAuthorizationState }
  | { status: "already_bound" };

export function posterFromClient(client: AomiClient): AuthorizationPoster {
  return (path, body) => client.request("POST", path, { body, raw: true });
}

export function authorizationChallenge(
  post: AuthorizationPoster,
  request: { chain_type: string; wallet: string; mode: string },
): Promise<AomiAuthorizationChallenge> {
  return post("/api/account/authorization/challenge", request);
}

export function authorizationCommit(
  post: AuthorizationPoster,
  request: {
    permit: AomiAuthorizationPermit;
    signature: string;
    signer?: string;
  },
): Promise<AomiAuthorizationState> {
  return post("/api/account/authorization/commit", request);
}

export async function ensureSvmWalletBoundVia(
  post: AuthorizationPoster,
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<AomiEnsureBoundResult> {
  let challenge: AomiAuthorizationChallenge;
  try {
    challenge = await authorizationChallenge(post, {
      chain_type: "svm",
      wallet,
      mode: "bind",
    });
  } catch (error) {
    if (isAlreadyBound(error)) return { status: "already_bound" };
    throw error;
  }

  if (!challenge.message_base64) {
    throw new Error("bind challenge returned no svm message payload");
  }

  const signature = await signMessage(base64ToBytes(challenge.message_base64));
  try {
    return {
      status: "bound",
      state: await authorizationCommit(post, {
        permit: challenge.permit,
        signature: bytesToBase64(signature),
      }),
    };
  } catch (error) {
    if (isAlreadyBound(error)) return { status: "already_bound" };
    throw error;
  }
}

export function ensureSvmWalletBound(
  client: AomiClient,
  wallet: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<AomiEnsureBoundResult> {
  return ensureSvmWalletBoundVia(posterFromClient(client), wallet, signMessage);
}

export function isUnboundWalletError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return text.includes("signing_unbound_wallet");
}

function isAlreadyBound(error: unknown): boolean {
  return error instanceof Error && error.message.includes("already_bound");
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  return btoa(String.fromCharCode(...bytes));
}
