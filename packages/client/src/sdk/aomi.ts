import type { ActionCapabilities } from "../actions";
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
import type { AccountTransport } from "../account/credits";
import { createEvmPaymentClient } from "../payment";

type AomiManagedAuthOptions = Omit<
  AomiClientOptions,
  "getAccountBearer" | "guest" | "oauth" | "x402"
> & {
  auth: AomiAuthStrategy;
};

type AomiExecutionOptions =
  | { wallet?: Wallets; actions?: never }
  | { actions?: ActionCapabilities; wallet?: never };

export type AomiOptions = (
  | AomiManagedAuthOptions
  | (Omit<AomiClientOptions, "x402"> & { auth?: never })
) &
  AomiExecutionOptions;

/** Product-oriented SDK facade. Use `raw` for wire-close protocol control. */
export class Aomi {
  readonly raw: AomiClient;
  readonly pipeline: AomiPipeline;
  readonly agent: AomiAgent;
  readonly account: AccountTransport;
  readonly auth: AomiAuthController;
  readonly wallet?: Wallets;

  constructor(options: AomiOptions) {
    const { actions, wallet, auth, ...unmanagedClientOptions } = options;
    const clientOptions: AomiClientOptions = unmanagedClientOptions;
    const fetchImpl = clientOptions.fetch ?? globalThis.fetch.bind(globalThis);
    const paidClientOptions: AomiClientOptions = {
      ...clientOptions,
      fetch: fetchImpl,
      x402: wallet?.evm ? createEvmPaymentClient(wallet.evm) : undefined,
    };

    if (auth) {
      if (
        clientOptions.oauth ||
        clientOptions.getAccountBearer ||
        clientOptions.guest !== undefined
      ) {
        throw new TypeError(
          "Aomi auth cannot be combined with oauth, getAccountBearer, or guest",
        );
      }
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
    this.pipeline = new AomiPipeline(this.raw.pipeline);
    this.account = this.raw.account;
    this.agent = new AomiAgent(this.raw.agent, this.raw, capabilities, () =>
      wallet ? walletUserState(wallet) : undefined,
    );
  }
}
