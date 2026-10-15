"use client";

import { useState } from "react";
import { LoadingPane } from "@/ui/aomi/loading-pane";
import { SigningSettings } from "../provider-policy-settings";
import { OnchainPolicySettings } from "./onchain-policy-settings";
import { TransactionSafetySettings } from "./transaction-safety-settings";

/** The Safety tab: the default level for new chats, then wallet signing.
 * Both sections load behind one spinner and appear together. */
export function PolicyPage() {
  const [guardLoaded, setGuardLoaded] = useState(false);
  const [signingLoaded, setSigningLoaded] = useState(false);
  const loaded = guardLoaded && signingLoaded;
  return (
    <>
      {loaded ? null : <LoadingPane label="Loading safety settings" />}
      <div hidden={!loaded} className="flex flex-col gap-8">
        <TransactionSafetySettings onLoad={() => setGuardLoaded(true)} />
        <SigningSettings onLoad={() => setSigningLoaded(true)} />
        <OnchainPolicySettings />
      </div>
    </>
  );
}
