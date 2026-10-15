import type { AomiClient } from "../client";
import type {
  AomiAccountWallet,
  AomiWalletBalance,
  AomiWalletRuleSettings,
  AomiWalletRuleUpdate,
} from "../account/wallets";

/**
 * The account's wallets: every wallet the model can use, the balance of one,
 * and an agent wallet's signing rule. Separate from `aomi.wallet`, which is this process's own
 * signer. OAuth clients need `agent:read`.
 */
export class AomiWallets {
  constructor(private readonly client: AomiClient) {}

  /** Every wallet the account owns, agent wallets first. */
  list(options: { signal?: AbortSignal } = {}): Promise<AomiAccountWallet[]> {
    return this.client.account.wallets.listWallets(options);
  }

  /** Native and token balances of one wallet (`w_<id>`), per chain. */
  balance(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiWalletBalance> {
    return this.client.account.wallets.walletBalance(id, options);
  }

  /** An agent wallet's signing rule: Pause and one Instant switch per client. */
  rule(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AomiWalletRuleSettings> {
    return this.client.account.wallets.walletRule(id, options);
  }

  /**
   * Replace an agent wallet's rule at the version that was read. Portal
   * sessions only; other callers get 403 `portal_session_required`.
   */
  setRule(
    id: string,
    update: AomiWalletRuleUpdate,
  ): Promise<AomiWalletRuleSettings> {
    return this.client.account.wallets.setWalletRule(id, update);
  }
}
