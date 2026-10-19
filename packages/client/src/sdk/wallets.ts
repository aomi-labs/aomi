import type { AomiClient } from "../client";
import type {
  AomiAccountWallet,
  AomiWalletBalance,
  AomiAgentRule,
} from "../account/wallets";

/**
 * The account's wallets: every wallet the model can use, the balance of one,
 * and the account's pause-all over its agent wallets. Separate from `aomi.wallet`, which is this process's own
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

  /** The account's pause-all: when locked, no agent wallet signs anything. */
  agentRule(options: { signal?: AbortSignal } = {}): Promise<AomiAgentRule> {
    return this.client.account.wallets.agentRule(options);
  }

  /**
   * Pause or resume every agent wallet at the version that was read. Portal sessions only; other
   * callers get 403 `portal_session_required`.
   */
  setAgentRule(rule: AomiAgentRule): Promise<AomiAgentRule> {
    return this.client.account.wallets.setAgentRule(rule);
  }
}
