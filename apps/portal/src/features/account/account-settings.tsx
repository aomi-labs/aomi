"use client";

import { AccountSigningView } from "./account-signing";
import { useAccountAcl } from "./use-account-acl";

/**
 * Account tab — the wallet signing policy (ACL) editor.
 *
 * Identity, signing policy, and exact-address delegation state come from the
 * canonical `/api/account` response, and
 * every mutation runs the backend's challenge → sign → commit permit ceremony.
 * Nothing here is optimistic: a mode flips on screen only after the backend
 * returns the committed row.
 */
export function AccountSettings() {
  const acl = useAccountAcl();

  if (acl.status === "loading") {
    return <AccountNotice>Loading your wallets…</AccountNotice>;
  }

  if (acl.status === "error") {
    return (
      <AccountNotice tone="danger">
        {acl.error ?? "Couldn't load your account."}
        <button
          onClick={() => void acl.refresh()}
          className="hover:text-aomi-fg ml-2 underline underline-offset-2"
        >
          Retry
        </button>
      </AccountNotice>
    );
  }

  return (
    <AccountSigningView
      wallets={acl.wallets}
      delegatedAccounts={acl.delegatedAccounts}
      unboundWallets={acl.unboundWallets}
      onCommit={acl.commitMode}
      onBindWallet={acl.bindWallet}
      onRevokeDelegation={acl.revokeDelegation}
      onStopAllAuto={acl.stopAllAuto}
      canConnectPrivy={acl.canConnectPrivy}
      onConnectPrivy={acl.connectPrivy}
      onRenewDelegation={acl.renewDelegation}
      blockedReason={acl.blockedReason}
    />
  );
}

function AccountNotice({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="flex-1 overflow-y-auto px-[22px] py-5">
      <p
        className={`text-[13px] ${tone === "danger" ? "text-aomi-danger" : "text-aomi-muted"}`}
      >
        {children}
      </p>
    </div>
  );
}
