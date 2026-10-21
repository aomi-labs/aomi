"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  AomiButton,
  AomiSheet,
  CanApproveTrades,
  ConnectionMark,
  SheetHeader,
} from "@aomi-labs/widget/host-composition";
import { StandalonePage } from "@/components/shell/standalone-page";
import { createPortalClient } from "../portal-client";

type Step =
  | { step: "enter" }
  | { step: "confirm"; code: string; clientId?: string }
  | { step: "connected" }
  | { step: "denied" }
  | { step: "failed" };

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
async function claim(code: string): Promise<{ clientId?: string } | null> {
  const response = await fetch(
    `/api/auth/device?${new URLSearchParams({ user_code: code })}`,
    { credentials: "include" },
  ).catch(() => null);
  const body = (await response?.json().catch(() => null)) as {
    status?: unknown;
    client_id?: unknown;
  } | null;
  if (!response?.ok || body?.status !== "pending") return null;
  return {
    clientId: typeof body.client_id === "string" ? body.client_id : undefined,
  };
}

export function DeviceSheet() {
  const initial = normalized(useSearchParams().get("user_code") ?? "");
  const [state, setState] = useState<Step>({ step: "enter" });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // "Can approve trades" for the terminal: on unless unticked here.
  const [approves, setApproves] = useState(true);

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

  const decide = async (code: string, accept: boolean, clientId?: string) => {
    setPending(true);
    const ok = await fetch(`/api/auth/device/${accept ? "approve" : "deny"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ userCode: code }),
    })
      .then((response) => response.ok)
      .catch(() => false);
    // The choice is written once the login went through; a failure leaves the
    // terminal on its default (approve on Aomi) and says nothing went wrong.
    if (ok && accept && clientId)
      await createPortalClient()
        .account.connections.setConnectionSettings(`oauth:${clientId}`, {
          approves,
        })
        .catch(() => undefined);
    setState(
      ok ? { step: accept ? "connected" : "denied" } : { step: "failed" },
    );
    setPending(false);
  };

  const mark = <ConnectionMark kind="cli" name="Terminal" size={36} />;
  if (state.step === "confirm")
    return (
      <AomiSheet backdrop={false}>
        <SheetHeader
          title="Connect your terminal?"
          description="Only continue if this matches the code in your terminal."
          onClose={() => void decide(state.code, false)}
        />
        <div className="flex flex-col items-center gap-4 px-5 pb-5">
          {mark}
          <p
            data-device-code
            className="border-aomi-border rounded-card w-full border border-dashed p-3.5 text-center font-mono text-[22px] font-semibold leading-none tracking-[0.14em]"
          >
            {state.code}
          </p>
          {state.clientId ? (
            <div className="w-full">
              <CanApproveTrades
                name="Terminal"
                checked={approves}
                here="Approve your waiting Ask trades with aomi tx approve"
                disabled={pending}
                onCheckedChange={setApproves}
              />
            </div>
          ) : null}
          <div className="flex w-full flex-col gap-2">
            <AomiButton
              variant="primary"
              className="h-10 w-full"
              disabled={pending}
              onClick={() => void decide(state.code, true, state.clientId)}
            >
              Connect
            </AomiButton>
            <AomiButton
              className="h-10 w-full"
              disabled={pending}
              onClick={() => void decide(state.code, false)}
            >
              It doesn’t match
            </AomiButton>
          </div>
        </div>
      </AomiSheet>
    );
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
          ? {
              title: "Terminal connected",
              description: "Go back to your terminal. You can close this tab.",
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
