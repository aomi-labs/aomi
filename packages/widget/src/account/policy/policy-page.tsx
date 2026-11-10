"use client";

import { useDisplayQuery } from "@aomi-labs/react";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useShellAomi } from "@/account/transport";
import { TransactionSafetySettings } from "./transaction-safety-settings";
import { accountSafetyQuery } from "./transaction-safety-api";

/**
 * The Safety tab: the transaction safety new chats start on. On-chain limits
 * live on each agent wallet (Manage › Limits).
 */
export function PolicyPage() {
  const safety = useDisplayQuery(
    accountSafetyQuery(useShellAomi().account.guard),
  );
  if (safety.isPending) return <LoadingPane label="Loading safety settings" />;
  return <TransactionSafetySettings />;
}
