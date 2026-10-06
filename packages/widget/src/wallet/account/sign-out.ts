import type { AomiWalletKit } from "../types";

/**
 * Canonical sign-out for wallet chrome (WalletPicker, DualWalletBar).
 *
 * The account runtime owns account-vs-widget teardown ordering (it revokes the
 * backend account before the widget session). Here we only ensure the wallet
 * connectors are disconnected afterwards even if that teardown throws, so no
 * provider connection is left dangling. Wallet-kit disconnect alone only signs
 * out the provider and must not substitute for this sequence.
 */
export async function signOutAndDisconnect(
  adapter: AomiWalletKit,
): Promise<void> {
  try {
    await adapter.signOutAccount?.();
  } finally {
    await adapter.disconnect?.({ family: "all" });
  }
}
