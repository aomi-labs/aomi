"use client";

import { useEffect, useState } from "react";
import type {
  AomiAccountProfile,
  AccountSessionProvider,
} from "@aomi-labs/client";

import { aomiBffUrl } from "@/app/config";
import type { EmbeddedWallet } from "@/lib/privy-wallet";

type AuthorizationState = {
  delegated: boolean;
  serverAuto: boolean;
  /** The backend profile has answered for the current embedded wallet. */
  resolved: boolean;
};

const unknown: AuthorizationState = {
  delegated: false,
  serverAuto: false,
  resolved: false,
};

type StoredAuthorizationState = AuthorizationState & { address: string };

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** Read the backend facts that survive a Mini App restart.
 *
 * Privy's `wallet.delegated` only proves that its signer was installed. The
 * backend callback and permit commit are separate writes, so the return view
 * must derive its completion state from the account profile rather than from
 * ephemeral hook state or a previous page instance.
 */
export function useAuthorizationState(input: {
  provider: AccountSessionProvider | null;
  wallet: EmbeddedWallet | null;
}): AuthorizationState {
  const [state, setState] = useState<StoredAuthorizationState | null>(null);
  const provider = input.provider;
  const wallet = input.wallet;

  useEffect(() => {
    if (!provider || !wallet) return;
    let current = true;
    const address = wallet.address;
    void provider()
      .then(async (token) => {
        const response = await fetch(`${aomiBffUrl}/api/account`, {
          credentials: "omit",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok)
          throw new Error(`account_state_failed_${response.status}`);
        return (await response.json()) as AomiAccountProfile;
      })
      .then((profile) => {
        if (!current) return;
        setState({
          address,
          delegated: profile.delegated_accounts.some(
            (row) =>
              row.address.chain === "evm" &&
              sameAddress(row.address.address, address) &&
              row.status === "active" &&
              row.revoked_at === null,
          ),
          serverAuto: profile.signing_policies.some(
            (row) =>
              row.address.chain === "evm" &&
              sameAddress(row.address.address, address) &&
              row.mode === "auto",
          ),
          resolved: true,
        });
      })
      // This read only restores a returning user's display. A transient read
      // failure must not block a fresh ceremony that can still prove every
      // write through its own authoritative endpoints.
      .catch(() => {
        if (current) setState({ address, ...unknown, resolved: true });
      });
    return () => {
      current = false;
    };
  }, [provider, wallet]);

  if (
    !provider ||
    !wallet ||
    !state ||
    !sameAddress(state.address, wallet.address)
  ) {
    return unknown;
  }
  return {
    delegated: state.delegated,
    serverAuto: state.serverAuto,
    resolved: state.resolved,
  };
}
