import { createServerFn } from "@tanstack/react-start";
export const readE2EWallet = createServerFn({ method: "GET" }).handler(
  async () => {
    const { devToolsAllowed } = await import("./server/env");
    if (!devToolsAllowed()) return null;
    const { getCookie } = await import("@tanstack/react-start/server");
    const { E2E_WALLET_COOKIE, verifyE2EWalletCookie } =
      await import("./server/bff/dev/e2e-wallet");
    const wallet = verifyE2EWalletCookie(getCookie(E2E_WALLET_COOKIE));
    return wallet
      ? {
          address: wallet.address,
          chainId: wallet.chainId,
          svmAddress: wallet.svmAddress,
          svmCluster: wallet.svmCluster,
        }
      : null;
  },
);
