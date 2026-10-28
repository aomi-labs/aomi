import type { ActionCapabilities } from "../actions";
import {
  commitCapabilities,
  type CommitCapabilities,
  type CommitRecoveryRecord,
  type CommitRecoveryStore,
} from "../commits";
import { AomiClient } from "../client";
import { createGuestSessionProvider } from "../guest-auth";
import type { AomiClientOptions } from "../types";
import { walletCapabilities } from "../wallet/capabilities";
import type { Wallets } from "../wallet/types";
import { walletUserState } from "../wallet/user-state";
import { AomiAgent } from "./agent";
import {
  createGuestAuthController,
  createOAuthAuthRuntime,
  createPassiveAuthController,
  type AomiAuthController,
  type AomiAuthStrategy,
} from "./auth";
import { AomiPipeline } from "./pipeline";
import { AomiCommits } from "./commits";
import { AomiWallets } from "./wallets";
import type { TransactionSafetyTransport } from "../transaction-safety";
import { AomiAccount } from "./account";
import { createEvmPaymentClient } from "../payment";

/** `baseUrl` defaults to https://chat.aomi.dev. */
type AomiConnectionOptions = Omit<AomiClientOptions, "baseUrl"> & {
  baseUrl?: string;
};

type AomiManagedAuthOptions = Omit<
  AomiConnectionOptions,
  "getAccountBearer" | "guest" | "oauth" | "x402"
> & {
  auth: AomiAuthStrategy;
};

type AomiExecutionOptions =
  | {
      /** What signs this process's commits: `viemSigner(...)`, `solanaSigner(...)`. */
      signer?: Wallets;
      /** @deprecated Use `signer`. */
      wallet?: Wallets;
      actions?: never;
      commits?: CommitCapabilities;
    }
  | {
      actions?: ActionCapabilities;
      signer?: never;
      wallet?: never;
      commits?: CommitCapabilities;
    };

export type AomiOptions = (
  | AomiManagedAuthOptions
  | (Omit<AomiConnectionOptions, "x402"> & { auth?: never })
) &
  AomiExecutionOptions;

/** Where `new Aomi()` talks when no `baseUrl` is given. */
const DEFAULT_BASE_URL = "https://chat.aomi.dev";

function memoryRecovery(): CommitRecoveryStore {
  const records = new Map<string, CommitRecoveryRecord>();
  return {
    load: (thread, commit) => records.get(`${thread}:${commit}`),
    save: (thread, commit, record) => {
      records.set(`${thread}:${commit}`, record);
    },
    remove: (thread, commit) => {
      records.delete(`${thread}:${commit}`);
    },
  };
}

/** Product-oriented SDK facade. Use `raw` for wire-close protocol control. */
export class Aomi {
  readonly raw: AomiClient;
  readonly pipeline: AomiPipeline;
  readonly agent: AomiAgent;
  /** Thread-less commits by ref (`/v1/commits/:ref`). */
  readonly commits: AomiCommits;
  /** The account's wallets and their balances (not this process's signer). */
  readonly wallets: AomiWallets;
  readonly account: AomiAccount;
  readonly transactionSafety: TransactionSafetyTransport;
  readonly auth: AomiAuthController;
  readonly wallet?: Wallets;

  constructor(options: AomiOptions = {}) {
    const { actions, commits, signer, auth, ...unmanagedClientOptions } =
      options;
    const wallet = signer ?? options.wallet;
    const clientOptions: AomiClientOptions = {
      baseUrl: DEFAULT_BASE_URL,
      ...unmanagedClientOptions,
    };
    const fetchImpl = clientOptions.fetch ?? globalThis.fetch.bind(globalThis);
    const paidClientOptions: AomiClientOptions = {
      ...clientOptions,
      fetch: fetchImpl,
      x402: wallet?.evm ? createEvmPaymentClient(wallet.evm) : undefined,
    };

    if (
      auth &&
      (clientOptions.oauth ||
        clientOptions.getAccountBearer ||
        clientOptions.guest !== undefined)
    )
      throw new TypeError(
        "Aomi auth cannot be combined with oauth, getAccountBearer, or guest",
      );
    if (auth?.kind === "bearer") {
      this.auth = createPassiveAuthController("custom");
      this.raw = new AomiClient({
        ...paidClientOptions,
        oauth: async ({ resource, scopes }) => ({
          accessToken: auth.token,
          resource,
          scopes,
          expiresAt: Number.MAX_SAFE_INTEGER,
        }),
        guest: false,
      });
    } else if (auth) {
      const runtime = createOAuthAuthRuntime({
        baseUrl: clientOptions.baseUrl,
        fetch: fetchImpl,
        strategy: auth,
      });
      this.auth = runtime.controller;
      this.raw = new AomiClient({
        ...paidClientOptions,
        oauth: runtime.tokenProvider,
        guest: false,
      });
    } else if (
      !clientOptions.oauth &&
      !clientOptions.getAccountBearer?.required &&
      clientOptions.guest !== false
    ) {
      const guest =
        typeof clientOptions.guest === "function"
          ? clientOptions.guest
          : createGuestSessionProvider({
              baseUrl: clientOptions.baseUrl,
              fetch: fetchImpl,
            });
      this.auth = createGuestAuthController(guest);
      this.raw = new AomiClient({ ...paidClientOptions, guest });
    } else {
      this.auth = createPassiveAuthController(
        clientOptions.oauth
          ? "custom"
          : clientOptions.getAccountBearer
            ? "session"
            : clientOptions.guest === false
              ? "none"
              : "custom",
      );
      this.raw = new AomiClient(paidClientOptions);
    }

    this.wallet = wallet;
    const capabilities = wallet ? walletCapabilities(wallet) : (actions ?? {});
    // A signer keeps its wallet attempts in memory, which lets browser
    // wallets send (and bundle with EIP-5792) instead of only signing.
    const commitOps =
      commits ??
      (signer
        ? commitCapabilities(signer, memoryRecovery())
        : wallet
          ? commitCapabilities(wallet)
          : {});
    this.pipeline = new AomiPipeline(this.raw.pipeline, this.raw, commitOps);
    this.commits = new AomiCommits(this.raw, commitOps);
    this.wallets = new AomiWallets(this.raw);
    this.account = new AomiAccount((method, path, requestOptions) =>
      this.raw.requestResponse(method, path, requestOptions),
    );
    this.transactionSafety = this.raw.transactionSafety;
    this.agent = new AomiAgent(
      this.raw.agent,
      this.raw,
      capabilities,
      () => (wallet ? walletUserState(wallet) : undefined),
      commitOps,
    );
  }
}
