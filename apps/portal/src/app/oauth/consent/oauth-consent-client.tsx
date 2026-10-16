"use client";

import { useMemo, useState } from "react";
import { Check, CircleCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@aomi-labs/widget/browser-auth";
import {
  AomiButton,
  AomiSheet,
  ConnectionMark,
  FootnoteLink,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
  signOutAndDisconnect,
  accountDisplayName,
  useAomiWalletKit,
} from "@aomi-labs/widget/host-composition";
import { StandalonePage } from "@/components/shell/standalone-page";
import { useOAuthClientName } from "../oauth-client-name";
import { oauthConsentRedirect } from "./consent-response";

const CHAT = "Chat with Aomi and read your wallets";
const TRADE = "Propose trades. Each one waits for you.";

/** What each scope lets the client do, in plain words; unknown scopes show as-is. */
const SCOPE_LINES: Record<string, string[]> = {
  "agent:read": [CHAT],
  "agent:write": [CHAT, TRADE],
  "mcp:agent": [CHAT, TRADE],
  "agent:actions:resolve": [TRADE],
  "pipeline:execute": [TRADE],
  "pipeline:catalog": ["Browse Aomi apps and tools"],
  "mcp:pipeline": ["Browse Aomi apps and tools"],
  "payments:submit": ["Pay for its own requests"],
  "account:apps:read": ["See your installed apps"],
  "account:apps:write": ["Install and remove apps"],
  "account:credentials:read": [
    "See which app keys are set, never their values",
  ],
  "account:credentials:write": ["Save and remove app keys"],
  offline_access: [],
  openid: [],
  profile: [],
  email: [],
};

/** Scopes a guest account may grant. */
const GUEST_SCOPES = new Set([
  "agent:read",
  "agent:write",
  "pipeline:catalog",
  "mcp:agent",
  "mcp:pipeline",
  "offline_access",
]);

/** Better Auth's consent page: Allow <Client>? in the wallet popup's sheet. */
export function OAuthConsentClient() {
  const name = useOAuthClientName(useSearchParams());
  return (
    <StandalonePage
      guest
      purpose={{
        icon: <ConnectionMark kind="app" name={name} size={16} />,
        text: `To connect ${name} to your account`,
      }}
    >
      <ConsentSheet name={name} />
    </StandalonePage>
  );
}

export function ConsentSheet({ name }: { name: string }) {
  const params = useSearchParams();
  const kit = useAomiWalletKit();
  const { data: session } = authClient.useSession();
  // Better Auth redirects here with the complete signed OAuth request in its
  // query string; the consent endpoint validates it before reading anything.
  const oauthQuery = params.toString();
  const guest = session?.user.isAnonymous === true;
  const scopes = useMemo(() => {
    const requested = (params.get("scope") ?? "").split(/\s+/).filter(Boolean);
    return guest
      ? requested.filter((scope) => GUEST_SCOPES.has(scope))
      : requested;
  }, [params, guest]);
  const lines = [
    ...new Set(scopes.flatMap((scope) => SCOPE_LINES[scope] ?? [scope])),
  ];
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (accept: boolean) => {
    if (!oauthQuery) return setError("This request is incomplete.");
    setPending(true);
    setError(null);
    const response = await fetch("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        accept,
        oauth_query: oauthQuery,
        // The signed request already passed the server policy; the route
        // validates this scope again before minting.
        scope: scopes.join(" "),
      }),
    }).catch(() => null);
    const redirect = oauthConsentRedirect(
      await response?.json().catch(() => null),
    );
    if (!response?.ok || !redirect) {
      setError("That didn’t go through. Try again.");
      setPending(false);
      return;
    }
    if (!accept) return window.location.assign(redirect);
    // Show "connected" for a moment before handing back to the client.
    setConnected(true);
    setTimeout(() => window.location.assign(redirect), 1200);
  };

  if (connected)
    return (
      <AomiSheet backdrop={false}>
        <SheetHeader
          title={`${name} is connected`}
          description={`Go back to ${name}. You can close this tab.`}
          onClose={() => window.close()}
        />
        <div className="flex flex-col items-center gap-4 px-5 pb-5">
          <CircleCheck
            className="text-aomi-success size-12"
            strokeWidth={1.5}
          />
          <SheetFootnote>
            It asks before every trade. Change that in Settings → Connections.
          </SheetFootnote>
        </div>
      </AomiSheet>
    );

  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title={`Allow ${name}?`}
        description={`${name} will use your Aomi account.`}
        onClose={() => void decide(false)}
      />
      <div className="flex flex-col items-center gap-4 px-5 pb-5">
        <ConnectionMark kind="app" name={name} size={36} />
        <span className="rounded-control bg-aomi-surface-2 type-meta max-w-full truncate px-2.5 py-1">
          {guest ? "Guest account" : accountDisplayName(kit.accountUser)}
        </span>
        <ul className="type-control flex w-full flex-col gap-1.5">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="text-aomi-success mt-0.5 size-4 shrink-0" />
              {line}
            </li>
          ))}
        </ul>
        {error ? (
          <div className="w-full">
            <SheetAlert>{error}</SheetAlert>
          </div>
        ) : null}
        <div className="flex w-full flex-col gap-2">
          <AomiButton
            variant="primary"
            className="h-10 w-full"
            disabled={pending}
            onClick={() => void decide(true)}
          >
            Allow
          </AomiButton>
          <AomiButton
            className="h-10 w-full"
            disabled={pending}
            onClick={() => void decide(false)}
          >
            Deny
          </AomiButton>
        </div>
        <SheetFootnote>
          Not you?{" "}
          <FootnoteLink
            onClick={() =>
              void signOutAndDisconnect(kit).catch(() => undefined)
            }
          >
            Use another account
          </FootnoteLink>
        </SheetFootnote>
      </div>
    </AomiSheet>
  );
}
