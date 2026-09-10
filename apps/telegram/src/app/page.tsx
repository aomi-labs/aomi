"use client";

import { useCanonicalAccount } from "@/hooks/use-canonical-account";
import { usePermissionControl } from "@/hooks/use-permission-control";
import { useTelegramLaunch } from "@/hooks/use-telegram-launch";

export default function Home() {
  const launch = useTelegramLaunch();
  const account = useCanonicalAccount(launch.context);
  const permission = usePermissionControl({
    launch: launch.context,
    provider: account.provider,
  });

  let message = "Signing you in…";
  if (launch.status === "loading") message = "Opening your wallet…";
  if (launch.status === "error") message = "Open this page from Telegram.";
  if (account.status === "loading") message = "Linking your Aomi account…";
  if (account.status === "error") {
    message = account.error
      ? `Could not link your account (${account.error}).`
      : "Could not link your account.";
  }
  if (account.status === "ready" && !permission.target) {
    message = "Your wallet is linked.";
  }
  if (permission.status === "signing") message = "Waiting for your signature…";
  if (permission.status === "done")
    message = "Permission updated. Return to Telegram.";
  if (permission.status === "error") {
    message = permission.error ?? "Permission was not updated.";
  }

  return (
    <main className="wallet-page">
      <section className="wallet-control" aria-live="polite">
        <p>{message}</p>
        {permission.target && account.status === "ready" && (
          <p>
            {permission.target.mode} for {permission.target.wallet}
          </p>
        )}
        {permission.status === "ready" && (
          <button
            className="para-button"
            type="button"
            onClick={permission.sign}
          >
            Sign permission
          </button>
        )}
      </section>
    </main>
  );
}
