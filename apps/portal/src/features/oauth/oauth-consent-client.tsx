import { useMemo, useState } from "react";
import { Check, CircleCheck } from "lucide-react";
import { useSearchParams } from "@/lib/navigation";
import { authClient } from "@aomi-labs/widget/browser-auth";
import {
  AomiButton,
  AomiSheet,
  ConnectionMark,
  ConsentWallets,
  FootnoteLink,
  SheetAlert,
  SheetFootnote,
  SheetHeader,
  signOutAndDisconnect,
  accountDisplayName,
  useAomiWalletKit,
  useConsentLanes,
} from "@aomi-labs/widget/host-composition";
import { StandalonePage } from "@/components/shell/standalone-page";
import { useOAuthClientName } from "./oauth-client-name";
import { createPortalClient } from "@/lib/portal-client";

export function oauthConsentRedirect(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const response = body as Record<string, unknown>;
  return response.redirect === true &&
    typeof response.url === "string" &&
    response.url.length > 0
    ? response.url
    : null;
}

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
  "account:credits:read": ["See your credits"],
  "account:credits:fund": ["Top up your credits"],
  "account:usage:read": ["See your usage"],
  "account:transaction-safety:read": ["See your trade safety settings"],
  "account:transaction-safety:write": ["Change your trade safety settings"],
  offline_access: [],
  openid: [],
  profile: [],
  email: [],
};

/** The plain lines for a scope list, once each. */
export function scopeLines(scopes: readonly string[]): string[] {
  return [...new Set(scopes.flatMap((scope) => SCOPE_LINES[scope] ?? [scope]))];
}

/** Scopes a guest account may grant. */
const GUEST_SCOPES = new Set([
  "agent:read",
  "agent:write",
  "pipeline:catalog",
  "mcp:agent",
  "mcp:pipeline",
  "offline_access",
]);

/** `/v1/apps/<app>/mcp`: a client locked to one app. */
const APP_MCP = /\/v1\/apps\/([a-z0-9][a-z0-9-_]{0,62})\/mcp$/;

/** The app an app-locked resource names, if the request asks for one. */
export function consentApp(resource: string | null): string | undefined {
  if (!resource) return undefined;
  try {
    return APP_MCP.exec(new URL(resource).pathname)?.[1];
  } catch {
    return undefined;
  }
}

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
  const lines = scopeLines(scopes);
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The grant went through but the wallet settings did not: where to go next.
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const client = useMemo(() => createPortalClient(), []);
  const resource = params.get("resource");
  const app = consentApp(resource);
  const askOnly = params.get("mode") === "ask";
  const clientId = params.get("client_id");
  // The lanes to write once the grant is made; Allow waits until they load.
  const lanes = useConsentLanes(client);
  const connectionKey = clientId ? `oauth:${clientId}` : undefined;

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
    await saveWallets(redirect);
  };

  /**
   * Write the wallet settings for the new grant, then hand back. A failure is
   * never shown as success; the backend keeps the connection on Ask meanwhile.
   */
  const saveWallets = async (redirect: string) => {
    setPending(true);
    const saved = guest || !connectionKey || (await lanes.save(connectionKey));
    setPending(false);
    if (!saved) return setUnsaved(redirect);
    setUnsaved(null);
    // Show "connected" for a moment before handing back to the client.
    setConnected(true);
    setTimeout(() => window.location.assign(redirect), 1200);
  };

  if (unsaved)
    return (
      <AomiSheet backdrop={false}>
        <SheetHeader
          title={`${name} is connected`}
          description="Its wallet settings didn’t save."
          onClose={() => window.close()}
        />
        <div className="flex flex-col gap-4 px-5 pb-5">
          <SheetAlert>
            {name} is connected, but its wallet settings didn’t save. Set them
            in Settings → Connections.
          </SheetAlert>
          <AomiButton
            variant="primary"
            className="h-10 w-full"
            disabled={pending}
            onClick={() => void saveWallets(unsaved)}
          >
            Try again
          </AomiButton>
          <SheetFootnote>
            Until then it asks before every trade.{" "}
            <FootnoteLink onClick={() => window.location.assign(unsaved)}>
              Go back to {name}
            </FootnoteLink>
          </SheetFootnote>
        </div>
      </AomiSheet>
    );

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
            Change which wallets it may use in Settings → Connections.
          </SheetFootnote>
        </div>
      </AomiSheet>
    );

  return (
    <AomiSheet backdrop={false}>
      <SheetHeader
        title={`Allow ${name}?`}
        description={
          app
            ? `${name} will use ${app.charAt(0).toUpperCase()}${app.slice(1)} with your Aomi account.`
            : `${name} will use your Aomi account.`
        }
        onClose={() => void decide(false)}
      />
      <div className="flex min-h-0 flex-col items-center gap-4 overflow-y-auto px-5 pb-4">
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
        {guest ? null : (
          <ConsentWallets
            client={client}
            connectionKey={connectionKey}
            name={name}
            app={app}
            askOnly={askOnly}
            onChange={lanes.onChange}
          />
        )}
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
      {/* Outside the scroll area, so the choice is always reachable. */}
      <div className="flex shrink-0 flex-col gap-2 px-5 pb-5 pt-1">
        {error ? <SheetAlert>{error}</SheetAlert> : null}
        <AomiButton
          variant="primary"
          className="h-10 w-full"
          disabled={pending || (!guest && !lanes.ready)}
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
    </AomiSheet>
  );
}
