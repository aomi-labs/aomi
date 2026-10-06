"use client";

import type { Hex } from "viem";
import type { WalletTxPayload } from "@aomi-labs/react";
import { toAAWalletCalls } from "@aomi-labs/react";
import type { AomiTxResult } from "../../types";
import type { SmartWalletsHook } from "./privy-auth";

export async function sendPrivySmartWalletTransaction({
  payload,
  smartWalletClient,
  getClientForChain,
  wagmiChainId,
  smartAddress,
}: {
  payload: WalletTxPayload;
  smartWalletClient: NonNullable<SmartWalletsHook["client"]>;
  getClientForChain: SmartWalletsHook["getClientForChain"];
  wagmiChainId?: number;
  smartAddress?: Hex;
}): Promise<AomiTxResult> {
  const targetChainId = payload.chainId ?? wagmiChainId ?? 1;
  const callList = toAAWalletCalls(payload, targetChainId);
  if (callList.length === 0) {
    throw new Error("pending_transaction_missing_call_data");
  }

  const client =
    (await getClientForChain({ id: targetChainId })) ?? smartWalletClient;
  const isBatch = callList.length > 1;
  const txHash = isBatch
    ? await (
        client.sendTransaction as (args: {
          calls: Array<{ to: Hex; value: bigint; data?: Hex }>;
        }) => Promise<Hex>
      )({
        calls: callList.map((c) => ({
          to: c.to,
          value: c.value,
          data: c.data,
        })),
      })
    : await client.sendTransaction({
        to: callList[0].to,
        value: callList[0].value,
        data: callList[0].data,
      });

  return {
    txHash,
    amount: payload.value,
    aaRequestedMode: isBatch ? "4337" : "none",
    aaResolvedMode: "4337",
    executionKind: "privy_smart_wallet_4337",
    batched: isBatch,
    callCount: callList.length,
    sponsored: undefined,
    SmartAccount4337: smartAddress,
  };
}
