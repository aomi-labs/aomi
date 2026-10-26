"use client";

import { useDisplayQuery } from "@aomi-labs/react";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { useShellTransport } from "@/account/transport";
import { OnchainPolicySettings } from "./onchain-policy-settings";
import { TransactionSafetySettings } from "./transaction-safety-settings";
import { accountSafetyQuery } from "./transaction-safety-api";

/** The Safety tab: the guard policy new chats start on (and Swig, behind its flag). */
export function PolicyPage() {
  const guard = useDisplayQuery(accountSafetyQuery(useShellTransport().json));
  if (guard.isPending) return <LoadingPane label="Loading safety settings" />;
  return (
    <div className="flex flex-col gap-8">
      <TransactionSafetySettings />
      <OnchainPolicySettings />
    </div>
  );
}
