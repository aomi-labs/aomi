"use client";

import { useEffect, useRef } from "react";
import { useAccount, useModal } from "@getpara/react-sdk-lite";

import { useCanonicalAccount } from "@/hooks/use-canonical-account";
import { usePermissionControl } from "@/hooks/use-permission-control";
import { useTelegramLaunch } from "@/hooks/use-telegram-launch";

export default function Home() {
  const { openModal } = useModal();
  const para = useAccount();
  const opened = useRef(false);
  const launch = useTelegramLaunch();
  const account = useCanonicalAccount(launch.context);
  const permission = usePermissionControl({
    launch: launch.context,
    provider: account.provider,
  });

  useEffect(() => {
    if (launch.status !== "ready" || opened.current) return;
    opened.current = true;
    openModal();
  }, [launch.status, openModal]);

  let message = "Sign in with Para";
  if (launch.status === "loading") message = "Opening Para…";
  if (launch.status === "error") message = "Open this page from Telegram.";
  if (account.status === "loading") message = "Linking your Aomi account…";
  if (account.status === "error") message = "Could not link your account.";
  if (account.status === "ready" && !permission.target) {
    message = "Para is linked.";
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
        {launch.status !== "error" && account.status !== "ready" && (
          <button
            className="para-button"
            type="button"
            onClick={() => openModal()}
          >
            {para.embedded.isConnected ? "Open Para" : "Continue with Para"}
          </button>
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
