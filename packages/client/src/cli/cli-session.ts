// =============================================================================
// CliSession — OO wrapper around file-backed CLI session state
// =============================================================================
//
// Replaces the read-modify-write pattern of readState()/writeState() with
// an object whose mutations auto-persist to disk.
//
// Multi-session management (list, activate, delete) stays as free functions
// in state.ts because they operate across all sessions, not on one instance.

import { ClientSession } from "../session";
import type { CliConfig } from "./types";
import {
  readState,
  writeState,
  type CliAuthSession,
  type CliOAuthGrant,
  type CliSessionState,
} from "./state";
import { buildCliUserState } from "./user-state";
import { parseSolanaKeypairSecret } from "./solana-signer";
import { createCliAuthTokenProvider } from "./auth";
import { DEFAULT_CLI_BASE_URL } from "./client-factory";
import { createCliPaymentFetch, type CliPaymentListener } from "./payment";
import type { AomiOAuthTokenProvider } from "../authorization";
import { signInWithOAuthDevice } from "./oauth-device-auth";
import { wrapFetchWithPublicApiAuthorization } from "../client";
import {
  createGuestSessionProvider,
  type GuestSessionProvider,
} from "../guest-auth";
import { cliActionCapabilities } from "./action-capabilities";

export class CliSession {
  private state: CliSessionState;

  private constructor(state: CliSessionState) {
    this.state = state;
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  /** Load the active session from disk. Returns null if none exists. */
  static load(): CliSession | null {
    const state = readState();
    if (!state) return null;
    const cli = new CliSession(state);
    if (cli.ensureSvmClusterInvariant()) cli.save();
    return cli;
  }

  /**
   * A persisted Solana address must always carry a persisted cluster so that
   * display, state file, and wire agree. State files written before
   * `wallet set --solana` persisted clusters get stamped with mainnet once.
   */
  private ensureSvmClusterInvariant(): boolean {
    if (this.state.svmPublicKey && !this.state.svmCluster) {
      this.state.svmCluster = "solana:mainnet";
      return true;
    }
    return false;
  }

  /** Load existing session or create a fresh one from config. */
  static loadOrCreate(config: CliConfig): CliSession {
    if (config.freshSession) {
      const existing = CliSession.load();
      return CliSession.create(config, existing?.toState());
    }
    const existing = CliSession.load();
    if (existing) {
      existing.mergeConfig(config);
      return existing;
    }
    return CliSession.create(config);
  }

  /** Create a fresh session and persist it. */
  static create(
    config: CliConfig,
    seed?: CliSessionState,
    sessionId: string = crypto.randomUUID(),
  ): CliSession {
    // Derive Solana public key from private key when provided.
    let svmPublicKey = config.svmPublicKey;
    if (config.solanaPrivateKey) {
      try {
        svmPublicKey = parseSolanaKeypairSecret(
          config.solanaPrivateKey,
        ).publicKey.toBase58();
      } catch {
        // Ignore — signing will produce a clearer error at sign time.
      }
    }

    const baseUrl = config.baseUrl ?? seed?.baseUrl ?? DEFAULT_CLI_BASE_URL;
    const state: CliSessionState = {
      sessionId,
      clientId: crypto.randomUUID(),
      baseUrl,
      app: config.app ?? seed?.app,
      model: config.model ?? seed?.model,
      apiKey: config.apiKey ?? seed?.apiKey,
      accountBearer: config.accountBearer ?? seed?.accountBearer,
      guestBearer: baseUrl === seed?.baseUrl ? seed.guestBearer : undefined,
      publicKey: config.publicKey ?? seed?.publicKey,
      privateKey: seed?.privateKey,
      svmPublicKey: svmPublicKey ?? seed?.svmPublicKey,
      svmCluster: config.svmCluster ?? seed?.svmCluster,
      // Carry forward only persisted Solana keys from `wallet set --solana`.
      // Keys supplied via --solana-private-key/env stay transient.
      svmPrivateKey: seed?.svmPrivateKey,
      chainId: config.chain ?? seed?.chainId,
      secretHandles: seed?.secretHandles,
      auth: seed?.auth,
      oauthGrants: seed?.oauthGrants,
    };
    const cli = new CliSession(state);
    cli.ensureSvmClusterInvariant();
    cli.save();
    return cli;
  }

  // ---------------------------------------------------------------------------
  // Read-only accessors
  // ---------------------------------------------------------------------------

  get sessionId(): string {
    return this.state.sessionId;
  }
  get baseUrl(): string {
    return this.state.baseUrl;
  }
  get app(): string | undefined {
    return this.state.app;
  }
  get model(): string | undefined {
    return this.state.model;
  }
  get modelSynced(): boolean {
    return this.state.modelSynced === true;
  }
  get apiKey(): string | undefined {
    return this.state.apiKey;
  }
  get publicKey(): string | undefined {
    return this.state.publicKey;
  }
  get privateKey(): string | undefined {
    return this.state.privateKey;
  }
  get svmPublicKey(): string | undefined {
    return this.state.svmPublicKey;
  }
  get svmCluster(): CliSessionState["svmCluster"] {
    return this.state.svmCluster;
  }
  get chainId(): number | undefined {
    return this.state.chainId;
  }
  get clientId(): string | undefined {
    return this.state.clientId;
  }
  get secretHandles(): Readonly<Record<string, string>> {
    return this.state.secretHandles ?? {};
  }
  get auth(): CliAuthSession | undefined {
    return this.state.auth;
  }
  get accountBearer(): string | undefined {
    return this.state.accountBearer;
  }
  get oauthGrants(): Readonly<Record<string, CliOAuthGrant>> {
    return this.state.oauthGrants ?? {};
  }

  // ---------------------------------------------------------------------------
  // Mutators (auto-persist)
  // ---------------------------------------------------------------------------

  /**
   * Apply config overrides (baseUrl, app, apiKey, publicKey, chain). Only
   * persists if something changed. Fields left `undefined` on the input are
   * NOT clobbered — settings commands like `wallet set` pass partial configs
   * and must not wipe out an existing `baseUrl`.
   */
  mergeConfig(config: Partial<CliConfig>): void {
    let changed = false;

    if (config.baseUrl !== undefined && config.baseUrl !== this.state.baseUrl) {
      this.state.baseUrl = config.baseUrl;
      delete this.state.guestBearer;
      changed = true;
    }
    if (config.app !== undefined && config.app !== this.state.app) {
      this.state.app = config.app;
      changed = true;
    }
    if (config.apiKey !== undefined && config.apiKey !== this.state.apiKey) {
      this.state.apiKey = config.apiKey;
      changed = true;
    }
    if (
      config.accountBearer !== undefined &&
      config.accountBearer !== this.state.accountBearer
    ) {
      this.state.accountBearer = config.accountBearer;
      changed = true;
    }
    if (
      config.publicKey !== undefined &&
      config.publicKey !== this.state.publicKey
    ) {
      this.state.publicKey = config.publicKey;
      changed = true;
    }
    if (
      config.svmPublicKey !== undefined &&
      config.svmPublicKey !== this.state.svmPublicKey
    ) {
      this.state.svmPublicKey = config.svmPublicKey;
      changed = true;
    }
    // Derive and persist the Solana public key when a keypair secret is provided.
    if (config.solanaPrivateKey !== undefined) {
      try {
        const svmPub = parseSolanaKeypairSecret(
          config.solanaPrivateKey,
        ).publicKey.toBase58();
        if (svmPub !== this.state.svmPublicKey) {
          this.state.svmPublicKey = svmPub;
          changed = true;
        }
      } catch {
        // Ignore parse failures — signing will produce a clearer error at sign time.
      }
    }
    if (
      config.svmCluster !== undefined &&
      config.svmCluster !== this.state.svmCluster
    ) {
      this.state.svmCluster = config.svmCluster;
      changed = true;
    }
    if (config.chain !== undefined && config.chain !== this.state.chainId) {
      this.state.chainId = config.chain;
      changed = true;
    }
    if (!this.state.clientId) {
      this.state.clientId = crypto.randomUUID();
      changed = true;
    }
    if (this.ensureSvmClusterInvariant()) changed = true;

    if (changed) this.save();
  }

  setModel(model: string): void {
    this.state.model = model;
    this.state.modelSynced = true;
    this.save();
  }

  setPublicKey(key: string): void {
    this.state.publicKey = key;
    this.save();
  }

  setBaseUrl(url: string): void {
    if (url !== this.state.baseUrl) delete this.state.guestBearer;
    this.state.baseUrl = url;
    this.save();
  }

  setPrivateKey(key: string): void {
    this.state.privateKey = key;
    this.save();
  }

  setWallet(privateKey: string, publicKey: string): void {
    this.state.privateKey = privateKey;
    this.state.publicKey = publicKey;
    this.save();
  }

  setSvmWallet(
    privateKey: string,
    publicKey: string,
    cluster?: NonNullable<CliSessionState["svmCluster"]>,
  ): void {
    this.state.svmPrivateKey = privateKey;
    this.state.svmPublicKey = publicKey;
    if (cluster !== undefined) {
      this.state.svmCluster = cluster;
    }
    this.save();
  }

  /** The Solana private key to use for signing. Prefers the transiently-
   * supplied `solanaPrivateKey` from `CliConfig` (i.e. `--solana-private-key`)
   * and falls back to the key persisted by `wallet set --solana`. */
  resolvedSvmPrivateKey(fromConfig?: string): string | undefined {
    return fromConfig ?? this.state.svmPrivateKey;
  }

  /** The effective runtime Solana cluster: `--cluster` wins, then the
   * persisted choice, then mainnet. Persistence paths stamp their defaults
   * before saving so display, state, and this resolver stay aligned. */
  resolvedSvmCluster(
    fromConfig?: CliSessionState["svmCluster"],
  ): NonNullable<CliSessionState["svmCluster"]> {
    return fromConfig ?? this.state.svmCluster ?? "solana:mainnet";
  }

  setChainId(id: number): void {
    this.state.chainId = id;
    this.save();
  }

  addSecretHandles(handles: Record<string, string>): void {
    this.state.secretHandles = {
      ...(this.state.secretHandles ?? {}),
      ...handles,
    };
    this.save();
  }

  clearSecretHandles(): void {
    this.state.secretHandles = {};
    this.save();
  }

  setAuthSession(auth: CliAuthSession): void {
    this.state.auth = auth;
    this.save();
  }

  setOAuthGrant(grant: CliOAuthGrant): void {
    this.state.oauthGrants = {
      ...this.state.oauthGrants,
      [grant.resource]: grant,
    };
    this.save();
  }

  clearOAuthGrants(): void {
    delete this.state.oauthGrants;
    this.save();
  }

  clearAuthSession(): void {
    if (!this.state.auth) return;
    delete this.state.auth;
    this.save();
  }

  clearSigningKeys(): void {
    let changed = false;
    if (this.state.privateKey !== undefined) {
      delete this.state.privateKey;
      changed = true;
    }
    if (this.state.svmPrivateKey !== undefined) {
      delete this.state.svmPrivateKey;
      changed = true;
    }
    if (changed) this.save();
  }

  /** Ensure clientId exists, generate if absent. Returns the clientId. */
  ensureClientId(): string {
    if (!this.state.clientId) {
      this.state.clientId = crypto.randomUUID();
      this.save();
    }
    return this.state.clientId;
  }

  // ---------------------------------------------------------------------------
  // Bridge to ClientSession
  // ---------------------------------------------------------------------------

  /** Build a ClientSession from the current state. */
  createClientSession(
    config?: Partial<CliConfig>,
    options?: { onPayment?: CliPaymentListener },
  ): ClientSession {
    const oauth = this.createOAuthProvider(fetch);
    const authorizedFetch = oauth
      ? wrapFetchWithPublicApiAuthorization({
          fetch,
          baseUrl: this.state.baseUrl,
          oauth,
        })
      : fetch;
    const paymentFetch = createCliPaymentFetch(
      config,
      options?.onPayment,
      authorizedFetch,
    );
    const session = new ClientSession(
      {
        baseUrl: this.state.baseUrl,
        apiKey: this.state.apiKey,
        fetch: paymentFetch,
        getAccountBearer: createCliAuthTokenProvider(() => this.state),
        oauth: paymentFetch ? undefined : oauth,
        // Account auth remains additive for control routes. Public Agent and
        // Pipeline requests still need a guest bearer until the user logs in.
        guest: oauth ? false : this.createGuestProvider(fetch),
      },
      {
        sessionId: this.state.sessionId,
        clientId: this.state.clientId,
        app: this.state.app,
        model: config?.model ?? this.state.model,
        applicationId: config?.applicationId,
        getUserState: () =>
          buildCliUserState(this.state.publicKey, this.state.chainId, {
            svmAddress: this.state.svmPublicKey,
            svmCluster: this.resolvedSvmCluster(config?.svmCluster),
          }),
        actions: cliActionCapabilities(this, config),
        inferenceFunding: config?.inferenceFunding,
      },
    );
    return session;
  }

  createGuestProvider(
    fetchImpl: typeof fetch,
    baseUrl?: string,
  ): GuestSessionProvider {
    const targetBaseUrl = baseUrl ?? this.state.baseUrl;
    // The persisted guest bearer was minted for the persisted base URL; only
    // reuse (or overwrite) it when this provider targets the same origin, so
    // a --backend-url override never sends or clobbers another origin's
    // credential.
    const canUsePersisted = targetBaseUrl === this.state.baseUrl;
    const guest = createGuestSessionProvider({
      baseUrl: targetBaseUrl,
      fetch: fetchImpl,
    });
    const provider = async (options?: { forceRefresh?: boolean }) => {
      if (!options?.forceRefresh && canUsePersisted && this.state.guestBearer) {
        return this.state.guestBearer;
      }
      const credential = await guest(options);
      if (
        canUsePersisted &&
        credential &&
        credential !== this.state.guestBearer
      ) {
        this.state.guestBearer = credential;
        this.save();
      }
      return credential;
    };
    return Object.assign(provider, {
      clear: () => {
        guest.clear();
        if (canUsePersisted && this.state.guestBearer) {
          delete this.state.guestBearer;
          this.save();
        }
      },
    });
  }

  createOAuthProvider(
    fetchImpl: typeof fetch,
  ): AomiOAuthTokenProvider | undefined {
    if (this.state.accountBearer) {
      const bearer = this.state.accountBearer;
      return async ({ resource, scopes }) => ({
        accessToken: bearer,
        expiresAt: Number.MAX_SAFE_INTEGER,
        resource,
        scopes,
        tokenType: "Bearer",
      });
    }
    if (
      !this.state.oauthGrants ||
      Object.keys(this.state.oauthGrants).length === 0
    ) {
      return undefined;
    }
    const pendingByResource = new Map<string, Promise<CliOAuthGrant>>();
    return async ({ resource, scopes, forceRefresh }) => {
      let grant = this.state.oauthGrants?.[resource];
      if (!grant || !scopes.every((scope) => grant?.scopes.includes(scope))) {
        const expandedScopes = Array.from(
          new Set([...(grant?.scopes ?? []), ...scopes, "offline_access"]),
        );
        const expandedGrant = await signInWithOAuthDevice({
          baseUrl: this.state.baseUrl,
          resource,
          scopes: expandedScopes,
          clientId: grant?.clientId,
          fetch: fetchImpl,
        });
        this.setOAuthGrant(expandedGrant);
        return expandedGrant;
      }
      if (!forceRefresh && grant.expiresAt > Date.now() + 30_000) return grant;
      if (!grant.refreshToken) return null;
      let pending = pendingByResource.get(resource);
      if (!pending) {
        pending = refreshCliGrant(fetchImpl, this.state.baseUrl, grant).finally(
          () => pendingByResource.delete(resource),
        );
        pendingByResource.set(resource, pending);
      }
      grant = await pending;
      this.setOAuthGrant(grant);
      return grant;
    };
  }

  /** Snapshot of the persisted session configuration. */
  toState(): CliSessionState {
    return { ...this.state };
  }

  /** Re-read state from disk (e.g. after another process may have written). */
  reload(): void {
    const fresh = readState();
    if (fresh) {
      this.state = fresh;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private save(): void {
    writeState(this.state);
  }
}

async function refreshCliGrant(
  fetchImpl: typeof fetch,
  baseUrl: string,
  grant: CliOAuthGrant,
): Promise<CliOAuthGrant> {
  const response = await fetchImpl(
    `${baseUrl.replace(/\/+$/, "")}/api/auth/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken ?? "",
        client_id: grant.clientId,
        resource: grant.resource,
        scope: grant.scopes.join(" "),
      }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(
      `OAuth refresh failed: ${String(body.error ?? response.status)}`,
    );
  }
  return {
    ...grant,
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : grant.refreshToken,
    expiresAt: Date.now() + Number(body.expires_in ?? 300) * 1000,
    scopes: String(body.scope ?? grant.scopes.join(" "))
      .split(/\s+/)
      .filter(Boolean),
    tokenType: body.token_type === "DPoP" ? "DPoP" : "Bearer",
  };
}
