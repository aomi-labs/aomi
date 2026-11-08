"use client";

import { useDisplayQuery } from "@aomi-labs/react";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useShellAomi } from "@/account/transport";
import { OnchainPolicySettings } from "./onchain-policy-settings";
import { TransactionSafetySettings } from "./transaction-safety-settings";
import { accountSafetyQuery } from "./transaction-safety-api";

/** The Safety tab: the transaction safety new chats start on, and Swig limits behind their flag. */
export function PolicyPage() {
  const safety = useDisplayQuery(
    accountSafetyQuery(useShellAomi().account.guard),
  );
  if (safety.isPending) return <LoadingPane label="Loading safety settings" />;
  return (
    <div className="flex flex-col gap-8">
      <TransactionSafetySettings />
      <OnchainPolicySettings />
    </div>
  );
}
