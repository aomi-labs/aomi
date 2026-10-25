"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BootstrapRelay = {
  type: "aomi.oauth.bootstrap.ticket";
  origin: string;
  ticket: string;
  state: string;
  clientId: string;
  resource: string;
  scopes: string[];
};

type AuthorizationContext = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: string[];
};

export function OAuthBootstrapClient() {
  const params = useSearchParams();
  const partnerOrigin = useMemo(
    () => normalizedPartnerOrigin(params.get("origin")),
    [params],
  );
  const [channelNonce, setChannelNonce] = useState<string | null>(null);
  const [relay, setRelay] = useState<BootstrapRelay | null>(null);
  const [preview, setPreview] = useState<{
    widget: { id: string; name: string };
    portal: { id: string; name: string } | null;
    sessionVersion: string | null;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const confirming = useRef(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => setChannelNonce(randomBrowserNonce()), []);

  useEffect(() => {
    if (!channelNonce) return;
    if (!partnerOrigin || !window.opener) {
      setStatus("This sign-in window was not opened by a valid Aomi client.");
      return;
    }
    const opener = window.opener;
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== opener || event.origin !== partnerOrigin) return;
      const value = event.data as Partial<BootstrapRelay> | null;
      if (
        value?.type !== "aomi.oauth.bootstrap.ticket" ||
        value.origin !== partnerOrigin ||
        typeof value.ticket !== "string" ||
        typeof value.state !== "string" ||
        typeof value.clientId !== "string" ||
        typeof value.resource !== "string" ||
        !Array.isArray(value.scopes) ||
        !value.scopes.every((scope) => typeof scope === "string")
      ) {
        return;
      }
      setRelay(value as BootstrapRelay);
    };
    window.addEventListener("message", receive);
    opener.postMessage(
      {
        type: "aomi.oauth.bootstrap.ready",
        origin: window.location.origin,
        channelNonce,
      },
      partnerOrigin,
    );
    return () => window.removeEventListener("message", receive);
  }, [channelNonce, partnerOrigin]);

  useEffect(() => {
    if (!relay || !partnerOrigin || !channelNonce) return;
    const controller = new AbortController();
    setPreview(null);
    setStatus("Checking your accounts…");
    void fetch("/api/auth/aomi/widget-bootstrap/preview", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        ticket: relay.ticket,
        origin: partnerOrigin,
        channelNonce,
        state: relay.state,
      }),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "This handoff expired or is unavailable. Close this window and try again.",
          );
        const accounts = await response.json();
        if (!controller.signal.aborted) {
          setPreview(accounts);
          setStatus(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setStatus(
            error instanceof Error
              ? error.message
              : "Unable to check accounts.",
          );
      });
    return () => controller.abort();
  }, [relay, partnerOrigin, channelNonce]);

  const confirm = useCallback(
    async (account: "widget" | "portal") => {
      if (
        !relay ||
        !partnerOrigin ||
        !channelNonce ||
        !preview ||
        pending ||
        confirming.current
      )
        return;
      confirming.current = true;
      setPending(true);
      setStatus("Continuing securely…");
      try {
        const response = await fetch("/api/auth/aomi/widget-bootstrap/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ticket: relay.ticket,
            origin: partnerOrigin,
            channelNonce,
            state: relay.state,
            confirmed: true,
            account,
            sessionVersion: preview.sessionVersion,
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          authorization?: AuthorizationContext;
          message?: string;
        } | null;
        if (!response.ok || !body?.authorization) {
          throw new Error(
            body?.message === "portal_session_changed"
              ? "Your portal account changed. Close this window and try again before choosing an account."
              : "The secure handoff expired or could not be completed. Close this window and try again.",
          );
        }
        const authorization = body.authorization;
        const query = new URLSearchParams({
          response_type: "code",
          client_id: authorization.clientId,
          redirect_uri: authorization.redirectUri,
          code_challenge: authorization.codeChallenge,
          code_challenge_method: authorization.codeChallengeMethod,
          resource: authorization.resource,
          scope: authorization.scopes.join(" "),
          state: relay.state,
        });
        window.location.replace(`/api/auth/oauth2/authorize?${query}`);
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : "Secure handoff failed",
        );
        setPreview(null);
        confirming.current = false;
        setPending(false);
      }
    },
    [channelNonce, partnerOrigin, relay, preview, pending],
  );

  useEffect(() => {
    if (preview?.portal?.id === preview?.widget.id && preview)
      void confirm("portal");
  }, [preview, confirm]);

  const mismatch = preview?.portal && preview.portal.id !== preview.widget.id;

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mismatch
            ? "Which account would you like to use?"
            : "Continue to Aomi"}
        </h1>
        {relay ? (
          <>
            <p className="text-muted-foreground mt-3 text-sm">
              Continue from {partnerOrigin}. You will review access before
              returning to the app. Accounts, credits and campaign history stay
              separate.
            </p>
            {preview && (
              <div className="mt-5 space-y-3 text-sm">
                <p>
                  App account: <strong>{preview.widget.name}</strong>{" "}
                  <span className="text-muted-foreground">
                    ({preview.widget.id.slice(0, 8)})
                  </span>
                </p>
                {mismatch && (
                  <p>
                    Portal account: <strong>{preview.portal!.name}</strong>{" "}
                    <span className="text-muted-foreground">
                      ({preview.portal!.id.slice(0, 8)})
                    </span>
                  </p>
                )}
              </div>
            )}
            <button
              className="bg-foreground text-background mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60"
              disabled={pending || !preview}
              onClick={() => void confirm("widget")}
              type="button"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {preview
                ? `Use ${preview.widget.name} on Aomi`
                : "Checking accounts…"}
            </button>
            {mismatch && (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void confirm("portal")}
                  className="border-border mt-3 flex h-11 w-full items-center justify-center rounded-md border px-4 text-sm font-medium disabled:opacity-60"
                >
                  Continue as {preview.portal!.name}
                </button>
                <p className="text-muted-foreground mt-3 text-sm">
                  This authorizes the app to use your portal account. Existing
                  campaigns remain with their original account.
                </p>
              </>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => window.close()}
              className="mt-3 h-11 w-full text-sm disabled:opacity-60"
            >
              Cancel
            </button>
          </>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            {status ?? "Waiting for the widget to complete the secure handoff…"}
          </p>
        )}
        {relay && status ? (
          <p className="text-muted-foreground mt-4 text-sm">{status}</p>
        ) : null}
      </section>
    </main>
  );
}

function normalizedPartnerOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.origin !== value) return null;
    if (parsed.protocol === "https:") return value;
    if (
      process.env.NODE_ENV !== "production" &&
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    ) {
      return value;
    }
  } catch {
    // Invalid origins are handled by the inert error state.
  }
  return null;
}

function randomBrowserNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
