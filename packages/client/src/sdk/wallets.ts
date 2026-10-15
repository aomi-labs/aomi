import type { AomiClient } from "../client";
import type { AomiAccountWallet, AomiWalletBalance } from "../account/wallets";

/**
 * The account's wallets, read-only: every wallet the model can use, and the
 * balance of one. Separate from `aomi.wallet`, which is this process's own
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
}
