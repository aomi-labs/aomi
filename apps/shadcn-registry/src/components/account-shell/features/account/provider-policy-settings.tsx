"use client";

import { AccountSigningView } from "./account-signing";
import { isProviderSigningWallet } from "./wallet-management-model";
import { useAccountAcl } from "./use-account-acl";

export function ProviderPolicySettings() {
  const acl = useAccountAcl();
  const wallets = acl.wallets.filter(isProviderSigningWallet);

  if (acl.status === "loading") {
    return (
      <p className="text-aomi-muted mx-auto w-full max-w-[780px] px-6 py-6 text-[12px]">
        Loading provider signing settings…
      </p>
    );
  }

  if (!wallets.length) return null;

  return (
    <AccountSigningView
      wallets={wallets}
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
