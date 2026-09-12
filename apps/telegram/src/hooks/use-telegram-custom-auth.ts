"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEmbeddedConnectedWallet,
  useLinkJwtAccount,
  useLogin,
  usePrivy,
  useSubscribeToJwtAuthWithFlag,
  useWallets,
} from "@privy-io/react-auth";

import { aomiBffUrl } from "@/app/config";
import type { LaunchContext } from "@/lib/telegram";

type BootstrapIntent = "status" | "authenticate" | "link" | "new";
type BootstrapResponse = {
  status?: unknown;
  custom_subject?: unknown;
  custom_auth_jwt?: unknown;
  error?: unknown;
};

export type TelegramCustomAuthState = {
  customSubject: string | null;
  error: string | null;
  phase:
    | "validating"
    | "choose"
    /** Privy's own login modal is open. */
    | "email"
    | "confirm"
    | "authenticating"
    | "ready"
    | "error";
  readyForExchange: boolean;
  existingWalletAddress: string | null;
  confirmExistingWallet: () => void;
  selectExistingWallet: () => void;
  selectNewWallet: () => void;
};

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "telegram_custom_auth_failed";
}

function isBootstrapResponse(value: BootstrapResponse | null): value is {
  status: "bound" | "unbound";
  custom_subject: string;
  custom_auth_jwt?: string;
} {
  return (
    (value?.status === "bound" || value?.status === "unbound") &&
    typeof value.custom_subject === "string"
  );
}

export function useTelegramCustomAuth(
  launch: LaunchContext | null,
): TelegramCustomAuthState {
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<TelegramCustomAuthState["phase"]>(
    "validating",
  );
  const [customSubject, setCustomSubject] = useState<string | null>(null);
  const [customJwt, setCustomJwt] = useState<string | null>(null);
  const { linkWithCustomJwt, state: linkState } = useLinkJwtAccount();
  // Only the existing-wallet path opens the modal, but Privy fires these
  // callbacks for any login it completes — including one that was already in
  // progress. The flag keeps this hook from reacting to someone else's flow.
  const awaitingModalLogin = useRef(false);
  const { login } = useLogin({
    onComplete: () => {
      if (!awaitingModalLogin.current) return;
      awaitingModalLogin.current = false;
      setPhase("confirm");
    },
    onError: (cause) => {
      if (!awaitingModalLogin.current) return;
      awaitingModalLogin.current = false;
      // `exited_auth_flow` is the user closing the modal, not a failure.
      if (cause === "exited_auth_flow") {
        setPhase("choose");
        return;
      }
      setError(`telegram_existing_wallet_${cause}`);
      setPhase("error");
    },
  });
  const { authenticated, ready: privyReady, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const existingWalletAddress = useMemo(
    () =>
      walletsReady
        ? (getEmbeddedConnectedWallet(wallets)?.address ?? null)
        : null,
    [wallets, walletsReady],
  );
  /** The Custom JWT identity Privy currently holds, if any. */
  const privyCustomSubject = useMemo(() => {
    const account = user?.linkedAccounts.find(
      (entry) => entry.type === "custom_auth",
    );
    return account && "customUserId" in account ? account.customUserId : null;
  }, [user]);
  // Readiness is a string comparison, not an SDK status. Privy re-runs its JWT
  // sync whenever its own state churns, so a level signal taken from that flow
  // flaps `done` -> `loading` -> `done` and tears down the account session
  // provider built on top of it. A Privy session whose Custom JWT subject is
  // this Telegram user is proof enough, and it survives those re-renders.
  // `linkState.status === "done"` counts too: Privy has confirmed the link for
  // the Custom JWT this hook just handed it, and `user.linkedAccounts` can lag
  // that confirmation by a render or two. Without it the watchdog below can
  // expire inside that window and fail a link that actually succeeded.
  const sessionMatchesTelegram =
    authenticated &&
    customSubject !== null &&
    (privyCustomSubject === customSubject || linkState.status === "done");
  const sessionRef = useRef<{
    authenticated: boolean;
    privyCustomSubject: string | null;
  }>({ authenticated: false, privyCustomSubject: null });
  // Declared before the bootstrap effect so that effect always reads the state
  // of the commit it is running in.
  useEffect(() => {
    sessionRef.current = { authenticated, privyCustomSubject };
  }, [authenticated, privyCustomSubject]);
  // Privy's sync logs the user out whenever `getExternalJwt` resolves
  // `undefined`, and it runs as soon as Privy is ready — before the bootstrap
  // that mints our JWT can answer. Left enabled, it therefore destroyed the
  // session Privy had just restored, on every single launch, which is what
  // forced a fresh login and its wait each time the Mini App opened.
  const jwtState = useSubscribeToJwtAuthWithFlag({
    enabled: customJwt !== null,
    isAuthenticated: Boolean(customJwt),
    isLoading: phase === "validating" || phase === "authenticating",
    getExternalJwt: async () => customJwt ?? undefined,
  });

  const bootstrap = useCallback(
    async (intent: BootstrapIntent) => {
      if (!launch?.proof) throw new Error("telegram_launch_unavailable");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch(
          `${aomiBffUrl}/api/auth/widget/telegram/custom-auth`,
          {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bot_id: launch.proof.botId,
            init_data: launch.proof.initData,
            intent,
          }),
            signal: controller.signal,
          },
        );
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error("telegram_custom_auth_timeout");
        }
        throw cause;
      } finally {
        clearTimeout(timeout);
      }
      const body = (await response
        .json()
        .catch(() => null)) as BootstrapResponse | null;
      if (!response.ok || !isBootstrapResponse(body)) {
        throw new Error(
          typeof body?.error === "string"
            ? `telegram_custom_auth_${body.error}`
            : `telegram_custom_auth_${response.status}`,
        );
      }
      setCustomSubject(body.custom_subject);
      return body;
    },
    [launch],
  );

  useEffect(() => {
    // Privy has to finish restoring before "is this session already ours?" can
    // be answered; asking earlier always answers no and costs a full re-login.
    if (!launch?.proof || !privyReady) return;
    let active = true;
    queueMicrotask(() => {
      void (async () => {
        const status = await bootstrap("status");
        if (!active) return;
        if (status.status !== "bound") {
          setPhase("choose");
          return;
        }
        if (
          sessionRef.current.authenticated &&
          sessionRef.current.privyCustomSubject === status.custom_subject
        ) {
          // The restored session already is this Telegram identity. Minting a
          // Custom JWT here would only make Privy re-authenticate the user it
          // is already holding, which is the wait the Mini App paid on every
          // open.
          setPhase("ready");
          return;
        }
        const authentication = await bootstrap("authenticate");
        if (!active) return;
        if (!authentication.custom_auth_jwt) {
          throw new Error("telegram_custom_auth_authenticate_not_issued");
        }
        setCustomJwt(authentication.custom_auth_jwt);
        setPhase("authenticating");
      })().catch((cause: unknown) => {
          if (!active) return;
          setError(errorCode(cause));
          setPhase("error");
      });
    });
    return () => {
      active = false;
    };
  }, [bootstrap, launch?.proof, privyReady]);

  const selectExistingWallet = useCallback(() => {
    setError(null);
    awaitingModalLogin.current = true;
    setPhase("email");
    // Privy's own modal owns email entry and the OTP. `disableSignup` keeps the
    // property the hand-rolled form had: this path may only reach a wallet that
    // already exists, never mint a second Privy user for the same person.
    login({ loginMethods: ["email"], disableSignup: true });
  }, [login]);

  const selectNewWallet = useCallback(() => {
    setError(null);
    setPhase("authenticating");
    void bootstrap("new")
      .then((result) => {
        if (!result.custom_auth_jwt) {
          throw new Error("telegram_custom_auth_new_not_issued");
        }
        setCustomJwt(result.custom_auth_jwt);
      })
      .catch((cause: unknown) => {
        setError(errorCode(cause));
        setPhase("error");
      });
  }, [bootstrap]);

  const confirmExistingWallet = useCallback(() => {
    setError(null);
    setPhase("authenticating");
    void bootstrap("link")
      .then(async (result) => {
        if (!result.custom_auth_jwt) {
          throw new Error("telegram_custom_auth_link_not_issued");
        }
        await linkWithCustomJwt(result.custom_auth_jwt);
        setCustomJwt(result.custom_auth_jwt);
      })
      .catch((cause: unknown) => {
        setError(errorCode(cause));
        setPhase("error");
      });
  }, [bootstrap, linkWithCustomJwt]);

  // A settled session has to cancel this timer. Nothing else moves `phase` off
  // `authenticating` on success, so a timer keyed on `phase` alone kept ticking
  // through a completed login and fired 15s later — flipping a working session
  // into `error`, which drops `readyForExchange` and disposes the account
  // session provider underneath an authorization that is already half
  // committed.
  useEffect(() => {
    if (phase !== "authenticating" || sessionMatchesTelegram) return;
    const timeout = setTimeout(() => {
      setError("telegram_custom_auth_timeout");
      setPhase("error");
    }, 15_000);
    return () => clearTimeout(timeout);
  }, [phase, sessionMatchesTelegram]);

  const readyForExchange = phase !== "error" && sessionMatchesTelegram;
  // `not-enabled` is the resting state of a sync we deliberately keep disabled
  // until a Custom JWT exists, so it only means "JWT auth is off for this Privy
  // app" once we have actually handed one over.
  const customFailure =
    jwtState.state.status === "error"
      ? errorCode(jwtState.state.error)
      : linkState.status === "error"
        ? errorCode(linkState.error)
        : customJwt !== null &&
            (jwtState.state.status === "not-enabled" ||
              linkState.status === "not-enabled")
          ? "telegram_custom_auth_not_enabled"
          : null;
  const effectivePhase = customFailure
    ? "error"
    : phase === "error"
      ? "error"
      : readyForExchange
      ? "ready"
      : phase;

  return {
    confirmExistingWallet,
    customSubject,
    error: customFailure ?? error,
    phase: effectivePhase,
    readyForExchange,
    existingWalletAddress,
    selectExistingWallet,
    selectNewWallet,
  };
}
