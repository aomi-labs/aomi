/**
 * Owner access for private apps in Chat.
 *
 * Build signs in with GitHub and Chat signs in with an Aomi account, so Chat
 * cannot tell on its own that the person opening a private app owns it.
 * Opening chat from here asks the Build BFF for a one-time owner claim and
 * hands it to Chat in the URL fragment (`#owner_claim=`). Chat redeems it for
 * the signed-in account, which then has access to exactly this app. The
 * fragment never reaches a server request line or log. Public apps, and any
 * failure to issue a claim, fall back to the plain chat link.
 */

export const OWNER_CLAIM_FRAGMENT = "owner_claim";

export async function ownerChatUrl(
  url: string,
  applicationId: number | string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const id = Number(applicationId);
  if (!Number.isSafeInteger(id) || id <= 0) return url;
  try {
    const response = await fetchImpl("/api/bff/deployments/owner-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: id }),
    });
    if (!response.ok) return url;
    const body = (await response.json()) as { claim?: unknown };
    if (typeof body.claim !== "string" || !body.claim) return url;
    const base = url.split("#")[0];
    return `${base}#${OWNER_CLAIM_FRAGMENT}=${encodeURIComponent(body.claim)}`;
  } catch {
    return url;
  }
}

/**
 * Click handler for an "Open chat" link: opens the tab synchronously (so the
 * popup is not blocked), then points it at the owner-claim URL.
 */
export function openOwnerChat(
  event: { preventDefault(): void },
  url: string,
  applicationId: number | string | null | undefined,
): void {
  const id = Number(applicationId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  event.preventDefault();
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  void ownerChatUrl(url, id).then((target) => {
    if (tab) tab.location.href = target;
    else window.location.assign(target);
  });
}
