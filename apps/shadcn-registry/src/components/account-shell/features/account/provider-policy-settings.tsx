"use client";

import { useEffect } from "react";
import { AccountSigningView } from "./account-signing";
import { useAccountAcl } from "./use-account-acl";

/** Safety tab: how each linked wallet signs, wired to the account ACL. */
export function SigningSettings({ onLoad }: { onLoad?: () => void } = {}) {
  const acl = useAccountAcl();
  const loaded = acl.status !== "loading";
  useEffect(() => {
    if (loaded) onLoad?.();
  }, [loaded, onLoad]);

  if (acl.status === "loading") return null;

  if (acl.status === "error") {
    return (
      <p role="alert" className="type-meta text-aomi-danger">
        {acl.error ?? "Could not load your signing settings."}
      </p>
    );
  }

  return (
    <AccountSigningView
      wallets={acl.wallets}
      delegatedAccounts={acl.delegatedAccounts}
      onCommit={acl.commitMode}
      onPrepare={acl.prepareMode}
      onSelectWallet={acl.selectWallet}
      onRevokeDelegation={acl.revokeDelegation}
      onStopAllAuto={acl.stopAllAuto}
      canConnectPrivy={acl.canConnectPrivy}
      onConnectPrivy={acl.connectPrivy}
      onRenewDelegation={acl.renewDelegation}
      blockedReason={acl.blockedReason}
    />
  );
}
