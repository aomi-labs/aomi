import type { EvmWallet, WalletEip712Payload } from "@aomi-labs/client";
import type { AomiWalletKit } from "./types";
import { createEvmPaymentClient } from "@aomi-labs/client";

export function createWidgetX402Client(
  wallet: Pick<AomiWalletKit, "identity" | "signTypedData" | "switchChain">,
): ReturnType<typeof createEvmPaymentClient> | undefined {
  const address = wallet.identity.address;
  const signTypedData = wallet.signTypedData;
  if (!address || !signTypedData) return undefined;
  const evmWallet: EvmWallet = {
    address,
    chainId: wallet.identity.chainId,
    signTypedData: async ({ typedData }) => {
      const result = await signTypedData({
        typed_data: typedData as WalletEip712Payload["typed_data"],
      });
      return result.signature;
    },
    switchChain: wallet.switchChain,
  };
  return createEvmPaymentClient(evmWallet);
}
