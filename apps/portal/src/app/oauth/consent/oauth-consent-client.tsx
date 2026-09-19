"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@aomi-labs/account/better-auth/client";
import { oauthConsentRedirect } from "./consent-response";

const DESCRIPTIONS: Record<string, string> = {
  "agent:read": "Read your Agent sessions",
  "agent:write": "Start and manage Agent turns",
  "agent:actions:resolve": "Resolve staged Agent actions",
  "pipeline:catalog": "Browse public Pipeline apps and tools",
  "pipeline:execute": "Attempt Pipeline execution under Aomi policy",
  "mcp:agent": "Connect to the Agent MCP server",
  "mcp:pipeline": "Connect to the Pipeline MCP server",
  "payments:submit": "Submit a client-held payment signature",
  "custody:delegate": "Use separately approved delegated custody",
  offline_access: "Stay connected with a refresh token",
};

export function OAuthConsentClient() {
  const params = useSearchParams();
  const { data: session } = authClient.useSession();
  // Better Auth redirects to the consent page with the complete signed OAuth
  // request in its query string. The consent endpoint validates this value
  // before it reads any user-selected fields.
  const oauthQuery = params.toString();
  const scopes = useMemo(
    () => (params.get("scope") ?? "").split(/\s+/).filter(Boolean),
    [params],
  );
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const acceptedScopes = useMemo(() => {
    if (session?.user.isAnonymous !== true) return scopes;
    const ceiling = new Set([
      "agent:read",
      "agent:write",
      "pipeline:catalog",
      "mcp:agent",
      "mcp:pipeline",
      "offline_access",
    ]);
    return scopes.filter((scope) => ceiling.has(scope));
  }, [scopes, session?.user.isAnonymous]);

  const decide = useCallback(
    async (accept: boolean) => {
      if (!oauthQuery) {
        return setStatus("This authorization request is incomplete.");
      }
      setPending(true);
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accept,
          oauth_query: oauthQuery,
          // The signed request has already passed the canonical server policy.
          // Echo it unchanged; the route validates it again before minting.
          scope: acceptedScopes.join(" "),
        }),
      });
      const redirect = oauthConsentRedirect(
        await response.json().catch(() => null),
      );
      if (!response.ok || !redirect) {
        setStatus(`Consent failed (HTTP ${response.status})`);
        setPending(false);
        return;
      }
      window.location.assign(redirect);
    },
    [acceptedScopes, oauthQuery],
  );

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">Review access</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Only approve the capabilities this client needs. A revoked JWT may
          remain valid for at most five minutes.
        </p>
        <ul className="mt-5 grid gap-2">
          {acceptedScopes.map((scope) => (
            <li
              className="text-muted-foreground flex items-center gap-2 text-sm"
              key={scope}
            >
              <ShieldCheck className="h-4 w-4" />
              {DESCRIPTIONS[scope] ?? scope}
            </li>
          ))}
        </ul>
        {acceptedScopes.length !== scopes.length ? (
          <p className="text-muted-foreground mt-4 text-sm">
            Guest accounts receive only the guest-safe subset of the requested
            access.
          </p>
        ) : null}
        {status ? (
          <p className="text-muted-foreground mt-4 text-sm">{status}</p>
        ) : null}
        <div className="mt-6 grid gap-3">
          <button
            className="bg-foreground text-background flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60"
            disabled={pending}
            onClick={() => void decide(true)}
            type="button"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Authorize
          </button>
          <button
            className="border-border h-11 rounded-md border px-4 text-sm font-medium disabled:opacity-60"
            disabled={pending}
            onClick={() => void decide(false)}
            type="button"
          >
            Deny
          </button>
        </div>
      </section>
    </main>
  );
}
