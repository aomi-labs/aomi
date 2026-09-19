import type { EvmWallet, WalletEip712Payload } from "@aomi-labs/client";
import type { AomiWalletKit } from "@aomi-labs/widget-lib";
import { createEvmPaymentClient } from "@aomi-labs/client";
import type { x402Client } from "@x402/core/client";

export function createPortalX402Client(
  wallet: Pick<AomiWalletKit, "identity" | "signTypedData" | "switchChain">,
): x402Client | undefined {
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
