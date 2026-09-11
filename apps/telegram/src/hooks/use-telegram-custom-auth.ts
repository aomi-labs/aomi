"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useLinkJwtAccount,
  useLoginWithEmail,
  useSubscribeToJwtAuthWithFlag,
} from "@privy-io/react-auth";

import { aomiBffUrl } from "@/app/config";
import type { LaunchContext } from "@/lib/telegram";

type BootstrapIntent = "status" | "link" | "new";
type BootstrapResponse = {
  status?: unknown;
  custom_subject?: unknown;
  custom_auth_jwt?: unknown;
  error?: unknown;
};

export type TelegramCustomAuthState = {
  code: string;
  customSubject: string | null;
  email: string;
  error: string | null;
  phase:
    | "validating"
    | "choose"
    | "email"
    | "authenticating"
    | "ready"
    | "error";
  readyForExchange: boolean;
  selectExistingWallet: () => void;
  selectNewWallet: () => void;
  setCode: (code: string) => void;
  setEmail: (email: string) => void;
  submitEmailCode: () => void;
  submitEmail: () => void;
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
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<TelegramCustomAuthState["phase"]>(
    "validating",
  );
  const [customSubject, setCustomSubject] = useState<string | null>(null);
  const [customJwt, setCustomJwt] = useState<string | null>(null);
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail();
  const { linkWithCustomJwt, state: linkState } = useLinkJwtAccount();
  const jwtState = useSubscribeToJwtAuthWithFlag({
    isAuthenticated: Boolean(customJwt),
    isLoading: phase === "validating" || phase === "authenticating",
    getExternalJwt: async () => customJwt ?? undefined,
  });

  const bootstrap = useCallback(
    async (intent: BootstrapIntent) => {
      if (!launch?.proof) throw new Error("telegram_launch_unavailable");
      const response = await fetch(
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
        },
      );
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
    if (!launch?.proof) return;
    let active = true;
    queueMicrotask(() => {
      void bootstrap("status")
        .then((result) => {
          if (!active) return;
          if (result.status === "bound" && result.custom_auth_jwt) {
            setCustomJwt(result.custom_auth_jwt);
            setPhase("authenticating");
            return;
          }
          setPhase("choose");
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setError(errorCode(cause));
          setPhase("error");
        });
    });
    return () => {
      active = false;
    };
  }, [bootstrap, launch?.proof]);

  const selectExistingWallet = useCallback(() => {
    setError(null);
    setCode("");
    setPhase("email");
  }, []);

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

  const submitEmail = useCallback(() => {
    setError(null);
    void sendCode({ email: email.trim(), disableSignup: true }).catch(
      (cause: unknown) => setError(errorCode(cause)),
    );
  }, [email, sendCode]);

  const submitEmailCode = useCallback(() => {
    setError(null);
    setPhase("authenticating");
    void loginWithCode({ code: code.trim() })
      .then(async () => {
        const result = await bootstrap("link");
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
  }, [bootstrap, code, linkWithCustomJwt, loginWithCode]);

  const readyForExchange =
    customSubject !== null &&
    customJwt !== null &&
    (jwtState.state.status === "done" || linkState.status === "done");
  const customFailure =
    jwtState.state.status === "error"
      ? errorCode(jwtState.state.error)
      : linkState.status === "error"
        ? errorCode(linkState.error)
        : jwtState.state.status === "not-enabled" ||
            linkState.status === "not-enabled"
          ? "telegram_custom_auth_not_enabled"
          : null;
  const effectivePhase = customFailure
    ? "error"
    : readyForExchange
      ? "ready"
      : phase;

  return {
    code,
    customSubject,
    email,
    error:
      customFailure ??
      error ??
      (emailState.status === "error" ? errorCode(emailState.error) : null),
    phase: effectivePhase,
    readyForExchange,
    selectExistingWallet,
    selectNewWallet,
    setCode,
    setEmail,
    submitEmail,
    submitEmailCode,
  };
}
