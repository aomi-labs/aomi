"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [pending, setPending] = useState(false);
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

  const confirm = useCallback(async () => {
    if (!relay || !partnerOrigin || !channelNonce) return;
    setPending(true);
    setStatus("Creating a secure Aomi session…");
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
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        authorization?: AuthorizationContext;
        message?: string;
      } | null;
      if (!response.ok || !body?.authorization) {
        throw new Error(body?.message ?? "The secure handoff expired");
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
      setPending(false);
    }
  }, [channelNonce, partnerOrigin, relay]);

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          Continue to Aomi
        </h1>
        {relay ? (
          <>
            <p className="text-muted-foreground mt-3 text-sm">
              Confirm the account handoff from {partnerOrigin}. You will review
              the final OAuth permissions before they are granted.
            </p>
            <dl className="border-border mt-5 grid gap-3 rounded-md border p-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="break-all font-mono">{relay.clientId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Resource</dt>
                <dd className="break-all font-mono">{relay.resource}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Requested access</dt>
                <dd className="mt-1 grid gap-1">
                  {relay.scopes.map((scope) => (
                    <span className="flex items-center gap-2" key={scope}>
                      <ShieldCheck className="h-4 w-4" /> {scope}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
            <button
              className="bg-foreground text-background mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60"
              disabled={pending}
              onClick={() => void confirm()}
              type="button"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm and review access
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
