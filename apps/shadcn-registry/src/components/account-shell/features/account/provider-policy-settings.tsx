"use client";

import { AccountSigningView } from "./account-signing";
import { useAccountAcl } from "./use-account-acl";

/** Safety tab: how each linked wallet signs, wired to the account ACL. */
export function SigningSettings() {
  const acl = useAccountAcl();

  if (acl.status === "loading") {
    return (
      <p role="status" className="type-meta text-aomi-muted">
        Loading signing settings…
      </p>
    );
  }

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
      onCreateAgentWallet={acl.createAgentWallet}
      blockedReason={acl.blockedReason}
    />
  );
}
