"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { UserPill } from "@privy-io/react-auth/ui";
import { AlertCircle, Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@aomi-labs/widget-lib/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@aomi-labs/widget-lib/components/ui/card";

import { useCanonicalAccount } from "@/hooks/use-canonical-account";
import { useAuthorizationState } from "@/hooks/use-authorization-state";
import { usePermissionControl } from "@/hooks/use-permission-control";
import { usePrivyDelegation } from "@/hooks/use-privy-delegation";
import { useTelegramCustomAuth } from "@/hooks/use-telegram-custom-auth";
import { useTelegramLaunch } from "@/hooks/use-telegram-launch";
import {
  resolveAction,
  resolveFailure,
  resolveHeadline,
  resolveStageStates,
  type CeremonyInput,
  type StageState,
} from "@/lib/ceremony";
import { explainError } from "@/lib/explain-error";
import { embeddedWallet } from "@/lib/privy-wallet";
import { launchProofIsFresh } from "@/lib/telegram";
import {
  closeApp,
  haptic,
  useTelegramBackButton,
  useTelegramChrome,
  useTelegramMainButton,
} from "@/lib/telegram-ui";

type Stage = {
  key: string;
  label: string;
  detail: string | null;
  state: StageState;
};

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

function StageRow({ stage }: { stage: Stage }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {stage.state === "active" && (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        )}
        {stage.state === "done" && (
          <Check className="text-aomi-success size-4" />
        )}
        {stage.state === "error" && (
          <AlertCircle className="text-destructive size-4" />
        )}
        {stage.state === "pending" && (
          <span className="border-border size-2 rounded-full border" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={
            stage.state === "pending"
              ? "text-muted-foreground text-sm"
              : "text-sm font-medium"
          }
        >
          {stage.label}
        </span>
        {stage.detail && (
          <span className="text-muted-foreground block truncate font-mono text-xs">
            {stage.detail}
          </span>
        )}
      </span>
    </li>
  );
}

export function WalletClient() {
  useTelegramChrome();

  const launch = useTelegramLaunch();
  const telegramAuth = useTelegramCustomAuth(launch.context);
  const account = useCanonicalAccount(launch.context, {
    readyForExchange: telegramAuth.readyForExchange,
    subject: telegramAuth.customSubject,
  });
  const { user } = usePrivy();
  const wallet = useMemo(() => embeddedWallet(user), [user]);
  const authorization = useAuthorizationState({
    provider: account.provider,
    wallet,
  });
  const delegation = usePrivyDelegation({
    launch: launch.context,
    provider: account.provider,
    wallet,
    delegated: authorization.delegated && wallet?.delegated === true,
  });
  const permission = usePermissionControl({
    launch: launch.context,
    provider: account.provider,
    serverAuto: authorization.serverAuto,
  });
  const [showDetail, setShowDetail] = useState(false);

  // The launch proof this app accepts for 24 hours is only good for five
  // minutes at the BFF. Watch the deadline so a Mini App left open says
  // "reopen this" instead of failing mid-ceremony with `expired`.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!launch.context?.proof) return;
    const check = () => setStale(!launchProofIsFresh(launch.context));
    check();
    const timer = setInterval(check, 15_000);
    return () => clearInterval(timer);
  }, [launch.context]);

  const linked = account.status === "ready";
  const signed = permission.status === "done";
  const authorizationReady = authorization.resolved || !wallet;

  const ceremony: CeremonyInput = {
    launch: { status: launch.status, error: launch.error },
    auth: {
      phase: telegramAuth.phase,
      error: telegramAuth.error,
      readyForExchange: telegramAuth.readyForExchange,
    },
    account: { status: account.status, error: account.error },
    delegation: { status: delegation.status, error: delegation.error },
    permission: {
      status: permission.status,
      error: permission.error,
      mode: permission.target?.mode ?? null,
    },
  };

  const resolved =
    resolveFailure(ceremony) ??
    // Not an error the ceremony produced, but the same kind of thing: the only
    // way forward is an action, and no progress message should hide it.
    (stale && !signed ? { source: "launch" as const, code: "expired" } : null);
  const retryFor: Record<string, (() => void) | null> = {
    permission: permission.sign,
    delegation: delegation.delegate,
    account: account.retry,
    auth: telegramAuth.retry,
    // Nothing to retry: the launch itself is not trustworthy.
    launch: null,
  };
  const failureCode = resolved?.code ?? null;
  const failure = resolved
    ? { code: resolved.code, retry: retryFor[resolved.source] }
    : null;

  const stageStates = resolveStageStates(ceremony);
  const action = stale || !authorizationReady ? null : resolveAction(ceremony);
  const headline = failure
    ? explainError(failure.code)
    : !authorizationReady && linked
      ? "Checking server-signing status…"
      : resolveHeadline(ceremony);

  const stages: Stage[] = [
    {
      key: "connect",
      label: "Verify Telegram",
      detail: null,
      state: stageStates.connect,
    },
    {
      key: "link",
      label: "Link your wallet",
      detail: wallet ? shortAddress(wallet.address) : null,
      state: stageStates.link,
    },
    {
      key: "delegate",
      label: "Enable server signing",
      detail: null,
      state: stageStates.delegate,
    },
    {
      key: "permit",
      label: permission.target
        ? `Authorize ${permission.target.mode.replace("_", " ")}`
        : "Authorize signing",
      detail: permission.target ? shortAddress(permission.target.wallet) : null,
      state: stageStates.permit,
    },
  ];

  const busy =
    !failure &&
    permission.status !== "done" &&
    (launch.status === "loading" ||
      (!authorizationReady && linked) ||
      delegation.status === "delegating" ||
      permission.status === "signing" ||
      (account.status !== "ready" &&
        telegramAuth.phase !== "choose" &&
        telegramAuth.phase !== "confirm"));

  const primary =
    action === "delegate"
      ? {
          label: "Enable server signing",
          onClick: () => void delegation.delegate(),
        }
      : action === "sign"
        ? { label: "Sign permission", onClick: () => void permission.sign() }
        : failure?.retry
          ? { label: "Try again", onClick: () => void failure.retry?.() }
          : null;
  // Telegram's own bottom button owns the primary action when it exists; the
  // in-page button below is the fallback for a client that has none.
  const nativeButton = useTelegramMainButton(primary && { ...primary, busy });
  useTelegramBackButton(telegramAuth.back);

  // Finish the ceremony inside Telegram rather than leaving the user to dismiss
  // a sheet that says it is done.
  useEffect(() => {
    if (!permission.signedHere) return;
    haptic("success");
    const timer = setTimeout(closeApp, 1200);
    return () => clearTimeout(timer);
  }, [permission.signedHere]);

  useEffect(() => {
    if (failureCode) haptic("error");
  }, [failureCode]);

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg tracking-tight">Aomi Wallet</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p
            className={`flex items-start gap-2 text-sm ${
              failure ? "text-destructive" : "text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {busy && (
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
            )}
            <span>{headline}</span>
          </p>

          <ul className="grid gap-3">
            {stages.map((stage) => (
              <StageRow key={stage.key} stage={stage} />
            ))}
          </ul>

          {launch.status === "ready" && telegramAuth.phase === "choose" && (
            <div className="grid gap-2">
              <Button onClick={telegramAuth.selectNewWallet}>
                Create new wallet
              </Button>
              <Button
                variant="outline"
                onClick={telegramAuth.selectExistingWallet}
              >
                Use existing wallet
              </Button>
            </div>
          )}

          {launch.status === "ready" && telegramAuth.phase === "confirm" && (
            <div className="grid gap-2">
              <p className="text-muted-foreground text-xs">
                Linking lets this Telegram account use
                {telegramAuth.existingWalletAddress
                  ? ` ${shortAddress(telegramAuth.existingWalletAddress)}`
                  : " your existing wallet"}{" "}
                from any approved Aomi bot.
              </p>
              <Button onClick={telegramAuth.confirmExistingWallet}>
                Confirm and link Telegram
              </Button>
            </div>
          )}

          {primary && !nativeButton && (
            <Button
              disabled={busy}
              variant={action ? "default" : "outline"}
              onClick={primary.onClick}
            >
              {primary.label}
            </Button>
          )}

          {failure && (
            // The raw code is what makes a staging failure diagnosable; it is
            // kept, just not shouted at someone who cannot act on it.
            <div className="text-muted-foreground text-xs">
              <button
                type="button"
                className="inline-flex items-center gap-1"
                onClick={() => setShowDetail((open) => !open)}
                aria-expanded={showDetail}
              >
                Details
                <ChevronDown
                  className={`size-3 transition-transform ${showDetail ? "rotate-180" : ""}`}
                />
              </button>
              {showDetail && (
                <p className="mt-1 break-all font-mono">{failure.code}</p>
              )}
            </div>
          )}

          {linked && (
            // Privy's own account control: wallet address, export, and the
            // linked-account list, none of which we should be rebuilding.
            <div className="flex justify-center">
              <UserPill expanded={false} ui={{ minimal: true }} />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
