"use client";

import { UserPill } from "@privy-io/react-auth/ui";

import { useCanonicalAccount } from "@/hooks/use-canonical-account";
import { usePermissionControl } from "@/hooks/use-permission-control";
import { useTelegramCustomAuth } from "@/hooks/use-telegram-custom-auth";
import { useTelegramLaunch } from "@/hooks/use-telegram-launch";

type Tone = "pending" | "ready" | "error";

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export default function Home() {
  const launch = useTelegramLaunch();
  const telegramAuth = useTelegramCustomAuth(launch.context);
  const account = useCanonicalAccount(launch.context, {
    readyForExchange: telegramAuth.readyForExchange,
    subject: telegramAuth.customSubject,
  });
  const permission = usePermissionControl({
    launch: launch.context,
    provider: account.provider,
  });

  // One waterfall, latest stage wins: each layer only speaks once the one
  // below it has something to say.
  let message = "Checking your Telegram account…";
  let tone: Tone = "pending";
  if (launch.status === "loading") message = "Opening your wallet…";
  if (launch.status === "error") {
    message = "Open this page from Telegram.";
    tone = "error";
  }
  if (telegramAuth.phase === "choose") {
    message = "Choose how to access your wallet.";
    tone = "ready";
  }
  if (telegramAuth.phase === "email") {
    message = "Use the email linked to your existing wallet.";
  }
  if (telegramAuth.phase === "confirm") {
    message = "Confirm that this Telegram account can access your existing wallet.";
    tone = "ready";
  }
  if (telegramAuth.phase === "authenticating") {
    message = "Signing you in…";
  }
  if (telegramAuth.phase === "error") {
    message = telegramAuth.error
      ? `Could not verify your wallet (${telegramAuth.error}).`
      : "Could not verify your wallet.";
    tone = "error";
  }
  if (account.status === "loading") message = "Linking your Aomi account…";
  if (account.status === "error") {
    message = account.error
      ? `Could not link your account (${account.error}).`
      : "Could not link your account.";
    tone = "error";
  }
  if (account.status === "ready" && !permission.target) {
    message = "Your wallet is linked.";
    tone = "ready";
  }
  if (permission.status === "ready") {
    message = "Review the permission below, then sign it.";
    tone = "ready";
  }
  if (permission.status === "signing") {
    message = "Waiting for your signature…";
    tone = "pending";
  }
  if (permission.status === "done") {
    message = "Permission updated. Return to Telegram.";
    tone = "ready";
  }
  if (permission.status === "error") {
    message = permission.error ?? "Permission was not updated.";
    tone = "error";
  }

  return (
    <main className="wallet-page">
      <section className="wallet-card">
        <h1 className="wallet-title">Aomi Wallet</h1>
        <p className="wallet-status" data-tone={tone} aria-live="polite">
          {tone === "pending" && <span className="wallet-spinner" />}
          {message}
        </p>

        {launch.status === "ready" && telegramAuth.phase === "choose" && (
          <div className="wallet-actions">
            <button
              className="wallet-button"
              type="button"
              onClick={telegramAuth.selectNewWallet}
            >
              Create new wallet
            </button>
            <button
              className="wallet-button wallet-button--quiet"
              type="button"
              onClick={telegramAuth.selectExistingWallet}
            >
              Use existing wallet
            </button>
          </div>
        )}

        {launch.status === "ready" && telegramAuth.phase === "confirm" && (
          <div className="wallet-actions">
            <dl className="wallet-facts">
              <dt>Wallet</dt>
              <dd className="wallet-mono">
                {telegramAuth.existingWalletAddress
                  ? shortAddress(telegramAuth.existingWalletAddress)
                  : "Your existing Privy wallet"}
              </dd>
            </dl>
            <p className="wallet-note">
              Linking lets this Telegram account access the wallet from any
              approved Aomi bot.
            </p>
            <button
              className="wallet-button"
              type="button"
              onClick={telegramAuth.confirmExistingWallet}
            >
              Confirm and link Telegram
            </button>
          </div>
        )}

        {permission.target && account.status === "ready" && (
          <div className="wallet-actions">
            <dl className="wallet-facts">
              <dt>Permission</dt>
              <dd>{permission.target.mode}</dd>
              <dt>Wallet</dt>
              <dd className="wallet-mono">
                {shortAddress(permission.target.wallet)}
              </dd>
              <dt>Chain</dt>
              <dd>{permission.target.chain}</dd>
            </dl>
            {permission.status === "ready" && (
              <button
                className="wallet-button"
                type="button"
                onClick={permission.sign}
              >
                Sign permission
              </button>
            )}
          </div>
        )}

        {account.status === "ready" && (
          // Privy's own account control: wallet address, export, and the
          // linked-account list, none of which we should be rebuilding.
          <div className="wallet-pill">
            <UserPill expanded={false} ui={{ minimal: true }} />
          </div>
        )}
      </section>
    </main>
  );
}
