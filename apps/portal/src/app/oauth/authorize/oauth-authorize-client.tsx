"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@aomi-labs/account/better-auth/client";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";

const STASH_KEY = "aomi.oauth.authorize.query";

export function OAuthAuthorizeClient() {
  const params = useSearchParams();
  const wallet = useAomiWalletKit();
  const { data: session } = authClient.useSession();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem(STASH_KEY, `?${params.toString()}`);
  }, [params]);

  useEffect(() => {
    if (!session?.session) return;
    resumeAuthorization();
  }, [session?.session]);

  const signIn = useCallback(async () => {
    setPending(true);
    setStatus("Opening secure sign-in…");
    try {
      await wallet.connectSocial?.("google");
      const credential = await waitForCredential(wallet.getAccountCredential);
      const response = await fetch("/api/auth/aomi/provider/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credential),
      });
      if (!response.ok) throw new Error("Sign-in could not be completed");
      resumeAuthorization();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sign-in failed");
      setPending(false);
    }
  }, [wallet]);

  const guest = useCallback(async () => {
    setPending(true);
    setStatus("Creating a private guest account…");
    const result = await authClient.signIn.anonymous();
    if (result.error) {
      setStatus(result.error.message ?? "Guest sign-in failed");
      setPending(false);
      return;
    }
    resumeAuthorization();
  }, []);

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect to Aomi
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Sign in to review the exact access requested by your app or MCP
          client.
        </p>
        {status ? (
          <p className="text-muted-foreground mt-4 text-sm">{status}</p>
        ) : null}
        <div className="mt-6 grid gap-3">
          <button
            className="bg-foreground text-background flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60"
            disabled={pending}
            onClick={() => void signIn()}
            type="button"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue with your account
          </button>
          <button
            className="border-border h-11 rounded-md border px-4 text-sm font-medium disabled:opacity-60"
            disabled={pending}
            onClick={() => void guest()}
            type="button"
          >
            Continue as guest
          </button>
        </div>
      </section>
    </main>
  );
}

function resumeAuthorization() {
  const query = sessionStorage.getItem(STASH_KEY) ?? window.location.search;
  sessionStorage.removeItem(STASH_KEY);
  window.location.replace(`/api/auth/oauth2/authorize${query}`);
}

async function waitForCredential(
  getCredential: (() => Promise<unknown>) | undefined,
): Promise<unknown> {
  if (!getCredential) throw new Error("No account provider is configured");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const credential = await getCredential().catch(() => null);
    if (credential) return credential;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for account sign-in");
}
