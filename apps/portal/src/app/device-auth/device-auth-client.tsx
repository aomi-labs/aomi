"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import {
  classifyProviderInitializationFailure,
  normalizeDeviceAuthProvider,
  providerConfigurationFailure,
  providerFailureText,
  type DeviceAuthProvider,
} from "@portal/lib/device-auth-provider";
import {
  deviceGrantFailure,
  providerExchangeFailure,
  waitForProviderCredential,
} from "@portal/lib/device-auth-handoff";

type GrantResponse = {
  code?: unknown;
  state?: unknown;
  redirectUri?: unknown;
};

const providerLabels = {
  privy: "Privy",
  para: "Para",
} as const;

export function DeviceAuthClient() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = normalizeDeviceAuthProvider(params.get("provider"));
  const mode = params.get("mode") === "link" ? "link" : "login";
  const request = useMemo(
    () => ({
      state: params.get("state") ?? "",
      codeChallenge: params.get("code_challenge") ?? "",
      redirectUri: params.get("redirect_uri") ?? "",
      linkIntent: params.get("link_intent") ?? "",
    }),
    [params],
  );

  if (
    !request.state ||
    !request.codeChallenge ||
    !request.redirectUri ||
    (mode === "link" && !request.linkIntent) ||
    !isApprovedCliLoopbackRedirectUri(request.redirectUri)
  ) {
    return <DeviceAuthLayout status="Invalid device auth request." />;
  }

  if (!provider) {
    return (
      <DeviceAuthLayout status="Choose a provider to continue.">
        <div className="mt-6 grid gap-3">
          <button
            className="bg-foreground text-background h-11 rounded-md px-4 text-sm font-medium"
            onClick={() => selectProvider(router, params, "privy")}
            type="button"
          >
            Continue with Privy
          </button>
          <button
            className="border-border h-11 rounded-md border px-4 text-sm font-medium"
            onClick={() => selectProvider(router, params, "para")}
            type="button"
          >
            Continue with Para
          </button>
        </div>
      </DeviceAuthLayout>
    );
  }

  const configurationFailure = providerConfigurationFailure(
    provider,
    providerConfiguration,
  );
  if (configurationFailure) {
    return (
      <DeviceAuthLayout status={providerFailureText(configurationFailure)} />
    );
  }

  return (
    <DeviceAuthProviderPanel
      mode={mode}
      provider={provider}
      request={request}
    />
  );
}

type HandoffPhase = "idle" | "provider" | "handoff" | "complete";

function DeviceAuthProviderPanel({
  mode,
  provider,
  request,
}: {
  mode: "login" | "link";
  provider: DeviceAuthProvider;
  request: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    linkIntent: string;
  };
}) {
  const walletKit = useAomiWalletKit();
  const connectSocial = walletKit.connectSocial;
  const getAccountCredential = walletKit.getAccountCredential;
  const label = providerLabels[provider];
  const [status, setStatus] = useState(
    `Continue with ${label} to ${
      mode === "link" ? "link this login method." : "connect your CLI."
    }`,
  );
  const [phase, setPhase] = useState<HandoffPhase>("idle");
  // Every click starts a new attempt. Cancelling or restarting bumps the
  // counter so an older attempt's async work can no longer touch the page.
  const attemptRef = useRef(0);
  // The attempt whose handoff (credential wait, exchange, grant) is running.
  // One handoff per attempt: the provider's getter identity can change while
  // a handoff is in flight, and that must not start a second exchange.
  const handoffAttemptRef = useRef<number | null>(null);

  const fail = useCallback(
    (error: unknown) => {
      setStatus(
        providerFailureText(
          classifyProviderInitializationFailure(
            provider,
            error,
            providerConfiguration,
          ),
        ),
      );
      setPhase("idle");
    },
    [provider],
  );

  const startProviderLogin = useCallback(async () => {
    const attempt = ++attemptRef.current;
    handoffAttemptRef.current = null;
    setPhase("provider");
    setStatus(`Opening ${label}...`);
    try {
      // Para resolves as soon as its modal opens; Privy resolves once login
      // completes. Either way the handoff below starts only when the provider
      // exposes an authenticated credential getter.
      await connectSocial?.("google");
      if (attemptRef.current !== attempt) return;
      setStatus(
        `Finish signing in with ${label}. This page returns to the CLI on its own.`,
      );
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      fail(error);
    }
  }, [connectSocial, fail, label]);

  const cancel = useCallback(() => {
    attemptRef.current += 1;
    handoffAttemptRef.current = null;
    setPhase("idle");
    setStatus(`Sign-in cancelled. Continue with ${label} to try again.`);
  }, [label]);

  useEffect(() => {
    if (phase !== "provider" || !getAccountCredential) return;
    const attempt = attemptRef.current;
    if (handoffAttemptRef.current === attempt) return;
    handoffAttemptRef.current = attempt;
    const live = () => attemptRef.current === attempt;
    setPhase("handoff");
    const run = async () => {
      try {
        setStatus(
          mode === "link"
            ? "Preparing account link..."
            : "Creating Aomi session...",
        );
        const credential = await waitForProviderCredential(
          getAccountCredential,
          { isCancelled: () => !live() },
        );
        if (!live()) return;
        if (mode === "link") {
          const grantResponse = await fetch(
            "/v1/account/device-auth/link-grant",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                linkIntent: request.linkIntent,
                state: request.state,
                redirectUri: request.redirectUri,
                provider,
                credential,
              }),
            },
          );
          if (!live()) return;
          const grant = (await grantResponse
            .json()
            .catch(() => null)) as GrantResponse | null;
          if (
            !grantResponse.ok ||
            typeof grant?.code !== "string" ||
            grant.state !== request.state
          ) {
            throw deviceGrantFailure(grantResponse.status, "link");
          }
          setPhase("complete");
          setStatus("Account link complete. Returning to the CLI...");
          redirectToCli({
            code: grant.code,
            redirectUri: request.redirectUri,
            state: request.state,
          });
          return;
        }
        const exchangeResponse = await fetch(
          "/api/auth/aomi/provider/exchange",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(credential),
          },
        );
        if (!live()) return;
        if (!exchangeResponse.ok) {
          throw providerExchangeFailure(exchangeResponse.status);
        }
        const grantResponse = await fetch("/v1/account/device-auth/grant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            state: request.state,
            codeChallenge: request.codeChallenge,
            redirectUri: request.redirectUri,
            provider,
          }),
        });
        if (!live()) return;
        const grant = (await grantResponse
          .json()
          .catch(() => null)) as GrantResponse | null;
        if (
          !grantResponse.ok ||
          typeof grant?.code !== "string" ||
          grant.state !== request.state
        ) {
          throw deviceGrantFailure(grantResponse.status, "login");
        }
        setPhase("complete");
        setStatus("Authentication complete. Returning to the CLI...");
        redirectToCli({
          code: grant.code,
          redirectUri: request.redirectUri,
          state: request.state,
        });
      } catch (error) {
        if (!live()) return;
        fail(error);
      }
    };
    void run();
  }, [phase, getAccountCredential, mode, provider, request, fail]);

  const busy = phase === "provider" || phase === "handoff";
  return (
    <DeviceAuthLayout status={status}>
      <div className="mt-6 grid gap-3">
        <button
          className="bg-foreground text-background flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy || phase === "complete"}
          onClick={() => void startProviderLogin()}
          type="button"
        >
          {phase === "complete" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Continue with {label}
        </button>
        {busy ? (
          <button
            className="border-border h-11 w-full rounded-md border px-4 text-sm font-medium"
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </DeviceAuthLayout>
  );
}

function DeviceAuthLayout({
  children,
  status,
}: {
  children?: ReactNode;
  status: string;
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to Aomi CLI
        </h1>
        <p className="text-muted-foreground mt-3 min-h-10 text-sm">{status}</p>
        {children}
      </section>
    </main>
  );
}

function redirectToCli(input: {
  code: string;
  redirectUri: string;
  state: string;
}) {
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set("code", input.code);
  redirect.searchParams.set("state", input.state);
  window.location.assign(redirect.toString());
}

function isApprovedCliLoopbackRedirectUri(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) return false;
  if (!/^\d{1,5}$/.test(url.port)) return false;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return false;
  return url.pathname === "/callback" && !url.search && !url.hash;
}

const providerConfiguration = {
  paraApiKey: process.env.NEXT_PUBLIC_PARA_API_KEY?.trim() ?? "",
  paraEnvironment: process.env.NEXT_PUBLIC_PARA_ENVIRONMENT?.trim() ?? "",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "",
};

function selectProvider(
  router: ReturnType<typeof useRouter>,
  params: ReturnType<typeof useSearchParams>,
  provider: DeviceAuthProvider,
): void {
  const next = new URLSearchParams(params.toString());
  next.set("provider", provider);
  router.replace(`/device-auth?${next.toString()}`);
}
