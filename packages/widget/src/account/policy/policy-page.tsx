"use client";

import { lazy, Suspense, useState } from "react";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { OnchainPolicySettings } from "./onchain-policy-settings";
import { TransactionSafetySettings } from "./transaction-safety-settings";

// Agent wallet rules, Locked wallets and Connected apps load with the tab.
const SafetyWallets = lazy(() =>
  import("../safety/safety-wallets").then((module) => ({
    default: module.SafetyWallets,
  })),
);

/** The Safety tab: the default level for new chats, then who may sign.
 * Both sections load behind one spinner and appear together. */
export function PolicyPage({ focusWallet }: { focusWallet?: string } = {}) {
  const [guardLoaded, setGuardLoaded] = useState(false);
  const [signingLoaded, setSigningLoaded] = useState(false);
  const loaded = guardLoaded && signingLoaded;
  return (
    <>
      {loaded ? null : <LoadingPane label="Loading safety settings" />}
      <div hidden={!loaded} className="flex flex-col gap-8">
        <TransactionSafetySettings onLoad={() => setGuardLoaded(true)} />
        <Suspense fallback={null}>
          <SafetyWallets
            onLoad={() => setSigningLoaded(true)}
            focusWallet={loaded ? focusWallet : undefined}
          />
        </Suspense>
        <OnchainPolicySettings />
      </div>
    </>
  );
}
