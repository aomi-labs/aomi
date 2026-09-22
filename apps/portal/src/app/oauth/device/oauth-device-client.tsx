"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@aomi-labs/account/better-auth/client";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import {
  classifyProviderInitializationFailure,
  normalizeDeviceAuthProvider,
  providerConfigurationFailure,
  providerFailureText,
  type DeviceAuthProvider,
} from "@portal/lib/device-auth-provider";
import {
  providerExchangeFailure,
  waitForProviderCredential,
} from "@portal/lib/device-auth-handoff";

type DeviceVerification = {
  user_code: string;
  status: "pending" | "approved" | "denied";
  client_id: string;
  scope?: string;
  resource?: string | string[];
};

const providerConfiguration = {
  paraApiKey: process.env.NEXT_PUBLIC_PARA_API_KEY?.trim() ?? "",
  paraEnvironment: process.env.NEXT_PUBLIC_PARA_ENVIRONMENT?.trim() ?? "",
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? "",
};

export function OAuthDeviceClient() {
  const router = useRouter();
  const params = useSearchParams();
  const provider = normalizeDeviceAuthProvider(params.get("provider"));
  const wallet = useAomiWalletKit();
  // The credential getter appears only after the provider reports
  // authentication, which happens after `signIn` has already started. Read it
  // through a ref so the running handoff sees the current wallet kit instead
  // of the one captured at click time.
  const walletRef = useRef(wallet);
  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);
  const { data: session } = authClient.useSession();
  const initialCode = params.get("user_code") ?? "";
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [verification, setVerification] = useState<DeviceVerification | null>(
    null,
  );
  const initiallyVerified = useRef(false);

  const verify = useCallback(async (): Promise<DeviceVerification | null> => {
    const userCode = normalizedUserCode(code);
    if (!userCode) {
      setVerification(null);
      setStatus("Enter the code shown by your CLI.");
      return null;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/auth/device?${new URLSearchParams({ user_code: userCode })}`,
        { credentials: "include" },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      const checked = parseDeviceVerification(body);
      if (!response.ok || !checked || checked.status !== "pending") {
        setVerification(null);
        setStatus(
          checked?.status === "approved" || checked?.status === "denied"
            ? `This device request is already ${checked.status}.`
            : `Device request verification failed (HTTP ${response.status}).`,
        );
        return null;
      }
      setVerification(checked);
      setStatus(
        "Review the client, resource, and permissions before continuing.",
      );
      return checked;
    } catch {
      setVerification(null);
      setStatus("Device request verification could not be reached.");
      return null;
    } finally {
      setPending(false);
    }
  }, [code]);

  useEffect(() => {
    if (!session?.session || !initialCode || initiallyVerified.current) return;
    initiallyVerified.current = true;
    void verify();
  }, [initialCode, session?.session, verify]);

  const signIn = useCallback(async () => {
    if (!provider) return;
    setPending(true);
    try {
      setStatus(`Finish signing in with ${providerLabel(provider)}.`);
      await wallet.connectSocial?.("google");
      // Para resolves as soon as its modal opens, so the budget here also
      // covers the time the user spends inside the provider's login UI.
      const credential = await waitForProviderCredential(
        (options) =>
          walletRef.current.getAccountCredential?.(options) ??
          Promise.resolve(null),
        { budgetMs: 180_000 },
      );
      const response = await fetch("/api/auth/aomi/provider/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credential),
      });
      if (!response.ok) throw providerExchangeFailure(response.status);
      window.location.reload();
      return;
    } catch (error) {
      setStatus(
        providerFailureText(
          classifyProviderInitializationFailure(
            provider,
            error,
            providerConfiguration,
          ),
        ),
      );
      setPending(false);
    }
  }, [provider, wallet]);

  const decide = useCallback(
    async (accept: boolean) => {
      setPending(true);
      // Better Auth claims the pending code for this authenticated browser in
      // the verification GET. Repeat it immediately before either decision so
      // approve/deny can never bypass ownership binding.
      const checked = await verify();
      if (!checked) return;
      setPending(true);
      try {
        const response = await fetch(
          `/api/auth/device/${accept ? "approve" : "deny"}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ userCode: checked.user_code }),
          },
        );
        setStatus(
          response.ok
            ? accept
              ? "Device authorized. You can return to the CLI."
              : "Device request denied."
            : `Authorization failed (HTTP ${response.status}).`,
        );
        if (response.ok) setVerification(null);
      } catch {
        setStatus("The device authorization service could not be reached.");
      } finally {
        setPending(false);
      }
    },
    [verify],
  );

  const configurationFailure = provider
    ? providerConfigurationFailure(provider, providerConfiguration)
    : null;

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Authorize Aomi CLI</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Confirm that the code shown by your CLI matches.
        </p>
        {!provider ? (
          <div className="mt-6 grid gap-3">
            <button
              className="bg-foreground text-background h-11 rounded-md"
              onClick={() => selectProvider(router, params, "privy")}
              type="button"
            >
              Continue with Privy
            </button>
            <button
              className="border-border h-11 rounded-md border"
              onClick={() => selectProvider(router, params, "para")}
              type="button"
            >
              Continue with Para
            </button>
          </div>
        ) : configurationFailure ? (
          <p className="text-muted-foreground mt-4 text-sm">
            {providerFailureText(configurationFailure)}
          </p>
        ) : (
          <>
            <input
              className="border-border mt-5 h-11 w-full rounded-md border px-3 font-mono uppercase"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setVerification(null);
                setStatus(null);
                initiallyVerified.current = true;
              }}
            />
            {status ? (
              <p className="text-muted-foreground mt-4 text-sm">{status}</p>
            ) : null}
            {session?.session ? (
              verification ? (
                <>
                  <DeviceRequestDetails verification={verification} />
                  <div className="mt-6 grid gap-3">
                    <button
                      disabled={pending}
                      className="bg-foreground text-background h-11 rounded-md disabled:opacity-60"
                      onClick={() => void decide(true)}
                      type="button"
                    >
                      Authorize device
                    </button>
                    <button
                      disabled={pending}
                      className="border-border h-11 rounded-md border disabled:opacity-60"
                      onClick={() => void decide(false)}
                      type="button"
                    >
                      Deny
                    </button>
                  </div>
                </>
              ) : (
                <button
                  disabled={pending || !code.trim()}
                  className="bg-foreground text-background mt-6 h-11 w-full rounded-md disabled:opacity-60"
                  onClick={() => void verify()}
                  type="button"
                >
                  Review request
                </button>
              )
            ) : (
              <button
                disabled={pending}
                className="bg-foreground text-background mt-6 h-11 w-full rounded-md disabled:opacity-60"
                onClick={() => void signIn()}
                type="button"
              >
                Sign in with {provider === "para" ? "Para" : "Privy"}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function DeviceRequestDetails({
  verification,
}: {
  verification: DeviceVerification;
}) {
  const resources = Array.isArray(verification.resource)
    ? verification.resource
    : verification.resource
      ? [verification.resource]
      : [];
  return (
    <dl className="border-border mt-5 grid gap-3 rounded-md border p-4 text-sm">
      <div>
        <dt className="text-muted-foreground">Client</dt>
        <dd className="mt-1 break-all font-mono">{verification.client_id}</dd>
      </div>
      {resources.length > 0 ? (
        <div>
          <dt className="text-muted-foreground">Resource</dt>
          {resources.map((resource) => (
            <dd className="mt-1 break-all font-mono" key={resource}>
              {resource}
            </dd>
          ))}
        </div>
      ) : null}
      <div>
        <dt className="text-muted-foreground">Permissions</dt>
        <dd className="mt-1 break-words">
          {verification.scope?.split(/\s+/).filter(Boolean).join(", ") ||
            "None requested"}
        </dd>
      </div>
    </dl>
  );
}

function parseDeviceVerification(value: unknown): DeviceVerification | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.user_code !== "string" ||
    typeof record.client_id !== "string" ||
    !["pending", "approved", "denied"].includes(String(record.status))
  ) {
    return null;
  }
  const resource = record.resource;
  if (
    resource !== undefined &&
    typeof resource !== "string" &&
    (!Array.isArray(resource) ||
      !resource.every((entry) => typeof entry === "string"))
  ) {
    return null;
  }
  return {
    user_code: record.user_code,
    status: record.status as DeviceVerification["status"],
    client_id: record.client_id,
    scope: typeof record.scope === "string" ? record.scope : undefined,
    resource: resource as string | string[] | undefined,
  };
}

function providerLabel(provider: DeviceAuthProvider): string {
  return provider === "para" ? "Para" : "Privy";
}

function normalizedUserCode(value: string): string {
  return value.trim().toUpperCase();
}

function selectProvider(
  router: ReturnType<typeof useRouter>,
  params: ReturnType<typeof useSearchParams>,
  provider: DeviceAuthProvider,
): void {
  const next = new URLSearchParams(params.toString());
  next.set("provider", provider);
  router.replace(`/oauth/device?${next.toString()}`);
}
