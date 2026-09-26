"use client";

import { PolicySettings } from "./policy-settings";
import { TransactionSafetySettings } from "./transaction-safety-settings";

export function PolicyPage() {
  return (
    <div className="space-y-8">
      <TransactionSafetySettings />
      <section aria-labelledby="onchain-permissions-heading">
        <h2
          id="onchain-permissions-heading"
          className="mb-3 text-sm font-medium"
        >
          On-chain permissions
        </h2>
        <PolicySettings />
      </section>
    </div>
  );
}
