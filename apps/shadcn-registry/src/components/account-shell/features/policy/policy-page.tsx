"use client";

import { PolicySettings } from "./policy-settings";
import { TransactionSafetySettings } from "./transaction-safety-settings";

/** The Safety tab: the default level for new chats, then wallet signing. */
export function PolicyPage() {
  return (
    <div className="flex flex-col gap-8">
      <TransactionSafetySettings />
      <PolicySettings />
    </div>
  );
}
