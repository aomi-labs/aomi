"use client";

import { useCanonicalAccount } from "@/hooks/use-canonical-account";
import { usePermissionControl } from "@/hooks/use-permission-control";
import { useTelegramCustomAuth } from "@/hooks/use-telegram-custom-auth";
import { useTelegramLaunch } from "@/hooks/use-telegram-launch";

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

  let message = "Checking your Telegram account…";
  if (launch.status === "loading") message = "Opening your wallet…";
  if (launch.status === "error") message = "Open this page from Telegram.";
  if (telegramAuth.phase === "choose") {
    message = "Choose how to access your wallet.";
  }
  if (telegramAuth.phase === "email") {
    message = "Use the email linked to your existing wallet.";
  }
  if (telegramAuth.phase === "confirm") {
    message = "Confirm that this Telegram account can access your existing wallet.";
  }
  if (telegramAuth.phase === "authenticating") {
    message = "Signing you in…";
  }
  if (telegramAuth.phase === "error") {
    message = telegramAuth.error
      ? `Could not verify your wallet (${telegramAuth.error}).`
      : "Could not verify your wallet.";
  }
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
        {launch.status === "ready" && telegramAuth.phase === "choose" && (
          <>
            <button
              className="para-button"
              type="button"
              onClick={telegramAuth.selectExistingWallet}
            >
              Use existing wallet
            </button>
            <button
              className="para-button"
              type="button"
              onClick={telegramAuth.selectNewWallet}
            >
              Create new wallet
            </button>
          </>
        )}
        {launch.status === "ready" && telegramAuth.phase === "email" && (
          <>
            <input
              aria-label="Email"
              autoComplete="email"
              className="para-button"
              inputMode="email"
              onChange={(event) => telegramAuth.setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={telegramAuth.email}
            />
            <button
              className="para-button"
              type="button"
              onClick={telegramAuth.submitEmail}
            >
              Send code
            </button>
            <input
              aria-label="Verification code"
              autoComplete="one-time-code"
              className="para-button"
              inputMode="numeric"
              onChange={(event) => telegramAuth.setCode(event.target.value)}
              placeholder="Verification code"
              value={telegramAuth.code}
            />
            <button
              className="para-button"
              type="button"
              onClick={telegramAuth.submitEmailCode}
            >
              Verify and link Telegram
            </button>
          </>
        )}
        {launch.status === "ready" && telegramAuth.phase === "confirm" && (
          <>
            <p>
              {telegramAuth.existingWalletAddress
                ? `Wallet ${telegramAuth.existingWalletAddress}`
                : "Your existing Privy wallet"}
            </p>
            <p>
              Linking lets this Telegram account access the wallet from any
              approved Aomi bot.
            </p>
            <button
              className="para-button"
              type="button"
              onClick={telegramAuth.confirmExistingWallet}
            >
              Confirm and link Telegram
            </button>
          </>
        )}
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
