"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  AomiButton,
  AomiSheet,
  ConnectionMark,
  ConsentWallets,
  SheetAlert,
  SheetHeader,
  useConsentLanes,
} from "@aomi-labs/widget/host-composition";
import { StandalonePage } from "@/components/shell/standalone-page";
import { scopeLines } from "../consent/oauth-consent-client";
import { createPortalClient } from "../portal-client";

/** A device request, as Better Auth verified it, and the client's registered name. */
type DeviceRequest = {
  code: string;
  clientId?: string;
  name?: string;
  scopes: string[];
  resource?: string;
};

type Step =
  | ({ step: "confirm" } & DeviceRequest)
  | ({ step: "unsaved" } & DeviceRequest)
  | { step: "enter" }
  | { step: "connected"; name?: string }
  | { step: "denied" }
  | { step: "failed" };

/** What each device resource opens, in plain words. */
const RESOURCES: Record<string, string> = {
  "/v1": "your Aomi account",
  "/v1/agent": "Aomi chat on your account",
  "/v1/pipeline": "Aomi apps and tools on your account",
  "/v1/account": "your account settings",
};

/** `aomi account login` registers one client per machine under this name. */
const firstParty = (name?: string) => Boolean(name?.startsWith("Aomi CLI · "));

const home = () => window.location.assign("/");
const normalized = (value: string) => value.trim().toUpperCase();

/** `aomi account login`'s device code: the wallet picker if needed, then the code. */
export function OAuthDeviceClient() {
  return (
    <StandalonePage
      purpose={{
        icon: <ConnectionMark kind="cli" name="Terminal" size={16} />,
        text: "To connect your terminal",
      }}
    >
      <DeviceSheet />
    </StandalonePage>
  );
}

/**
 * Read a code once: the read claims it for this signed-in browser, and Better
 * Auth allows only a few reads per code lifetime.
 */
async function claim(
  code: string,
): Promise<Omit<DeviceRequest, "code"> | null> {
  const response = await fetch(
    `/api/auth/device?${new URLSearchParams({ user_code: code })}`,
    { credentials: "include" },
  ).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    status?: unknown;
    client_id?: unknown;
    scope?: unknown;
    resource?: unknown;
  } | null;
  if (!response?.ok || body?.status !== "pending") return null;
  const clientId =
    typeof body.client_id === "string" ? body.client_id : undefined;
  return {
    clientId,
    name: clientId ? await clientName(clientId) : undefined,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/) : [],
    resource: typeof body.resource === "string" ? body.resource : undefined,
  };
}

/** The client's registered name, from Better Auth's own record. */
async function clientName(clientId: string): Promise<string | undefined> {
  const response = await fetch(
    `/api/auth/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`,
    { credentials: "include" },
  ).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    client_name?: unknown;
  } | null;
  return response?.ok && typeof body?.client_name === "string"
    ? body.client_name
    : undefined;
}

export function DeviceSheet() {
  const initial = normalized(useSearchParams().get("user_code") ?? "");
  const [state, setState] = useState<Step>({ step: "enter" });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const client = useMemo(() => createPortalClient(), []);
  // The terminal's lanes, written once the login went through.
  const lanes = useConsentLanes(client);

  const check = useCallback(async (code: string) => {
    setPending(true);
    const claimed = await claim(code);
    setState(
      claimed ? { step: "confirm", code, ...claimed } : { step: "failed" },
    );
    setPending(false);
  }, []);
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!initial || checked.current === initial) return;
    checked.current = initial;
    void check(initial);
  }, [check, initial]);

  const decide = async (request: DeviceRequest, accept: boolean) => {
    setPending(true);
    const ok = await fetch(`/api/auth/device/${accept ? "approve" : "deny"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userCode: request.code }),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok && accept) return saveWallets(request);
    setState(
      ok ? { step: accept ? "connected" : "denied" } : { step: "failed" },
    );
    setPending(false);
  };

  /** The login went through; its wallet settings are never claimed unsaved. */
  const saveWallets = async (request: DeviceRequest) => {
    setPending(true);
    const saved =
      !request.clientId || (await lanes.save(`oauth:${request.clientId}`));
    setState(
      saved
        ? { step: "connected", name: request.name }
        : { ...request, step: "unsaved" },
    );
    setPending(false);
  };

  if (state.step === "unsaved") {
    const who = firstParty(state.name) ? "Your terminal" : (state.name ?? "It");
    return (
      <AomiSheet backdrop={false}>
        <SheetHeader
          title={`${who} is connected`}
          description="Its wallet settings didn’t save."
          onClose={home}
        />
        <div className="flex flex-col gap-4 px-5 pb-5">
          <SheetAlert>
            The wallet settings you picked didn’t save, so it keeps its current
            ones. Try again, or set them in Settings → Connections.
          </SheetAlert>
          <AomiButton
            variant="primary"
            className="h-10 w-full"
            disabled={pending}
            onClick={() => void saveWallets(state)}
          >
            Try again
          </AomiButton>
        </div>
      </AomiSheet>
    );
  }
  if (state.step === "confirm") {
    const cli = firstParty(state.name);
    const name = state.name ?? "An unknown app";
    const resource =
      (state.resource && RESOURCES[new URL(state.resource).pathname]) ??
      "your Aomi account";
    return (
      <AomiSheet backdrop={false}>
        <SheetHeader
          title={cli ? "Connect your terminal?" : `Allow ${name}?`}
          description={`Only continue if this matches the code in your ${cli ? "terminal" : "app"}.`}
          onClose={() => void decide(state, false)}
        />
        <div className="flex min-h-0 flex-col items-center gap-4 overflow-y-auto px-5 pb-4">
          <ConnectionMark
            kind={cli ? "cli" : "app"}
            name={cli ? "Terminal" : name}
            size={36}
          />
          {cli ? null : (
            <div className="w-full">
              <SheetAlert>
                This isn’t the Aomi CLI. Only continue if you started this
                sign-in yourself and trust {name}.
              </SheetAlert>
            </div>
          )}
          <p
            data-device-code
            className="border-aomi-border rounded-card w-full border border-dashed p-3.5 text-center font-mono text-[22px] font-semibold leading-none tracking-[0.14em]"
          >
            {state.code}
          </p>
          <p className="type-meta w-full">
            {name} can use {resource} to:
          </p>
          <ul
            aria-label="What it can do"
            className="type-control flex w-full flex-col gap-1.5"
          >
            {scopeLines(state.scopes).map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="text-aomi-success mt-0.5 size-4 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
          {state.clientId ? (
            <ConsentWallets
              client={client}
              connectionKey={`oauth:${state.clientId}`}
              name={cli ? "terminal" : name}
              startLane="here"
              onChange={lanes.onChange}
            />
          ) : null}
        </div>
        {/* Outside the scroll area, so the choice is always reachable. */}
        <div className="flex shrink-0 flex-col gap-2 px-5 pb-5 pt-1">
          <AomiButton
            variant="primary"
            className="h-10 w-full"
            disabled={pending || (Boolean(state.clientId) && !lanes.ready)}
            onClick={() => void decide(state, true)}
          >
            Connect
          </AomiButton>
          <AomiButton
            className="h-10 w-full"
            disabled={pending}
            onClick={() => void decide(state, false)}
          >
            It doesn’t match
          </AomiButton>
        </div>
      </AomiSheet>
    );
  }
  if (state.step === "enter")
    return initial ? null : (
      <AomiSheet backdrop={false}>
        <SheetHeader
          title="Connect your terminal"
          description="Enter the code from your terminal."
          onClose={home}
        />
        <form
          className="flex flex-col gap-4 px-5 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) void check(normalized(draft));
          }}
        >
          <input
            autoFocus
            value={draft}
            aria-label="Code from your terminal"
            onChange={(event) => setDraft(event.target.value)}
            className="border-aomi-border bg-aomi-bg rounded-control h-10 w-full border px-3 text-center font-mono uppercase tracking-[0.14em] outline-none"
          />
          <AomiButton
            type="submit"
            variant="primary"
            className="h-10 w-full"
            disabled={pending || !draft.trim()}
          >
            Continue
          </AomiButton>
        </form>
      </AomiSheet>
    );
  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        {...(state.step === "connected"
          ? firstParty(state.name)
            ? {
                title: "Terminal connected",
                description:
                  "Go back to your terminal. You can close this tab.",
              }
            : {
                title: `${state.name ?? "The app"} is connected`,
                description:
                  "Go back to where you started. You can close this tab.",
              }
          : state.step === "denied"
            ? { title: "Not connected", description: "You can close this tab." }
            : {
                title: "This code doesn’t work",
                description: "Run aomi account login again in your terminal.",
              })}
        onClose={home}
      />
      {state.step === "connected" ? (
        <div className="flex justify-center px-5 pb-5">
          <CircleCheck
            className="text-aomi-success size-12"
            strokeWidth={1.5}
          />
        </div>
      ) : null}
    </AomiSheet>
  );
}
