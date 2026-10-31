import { useEffect, useState } from "react";

/**
 * The OAuth client's registered name, from Better Auth's public client fields.
 * The signed authorize query lets this run before sign-in.
 */
export function useOAuthClientName(query: URLSearchParams): string {
  const clientId = query.get("client_id");
  const oauthQuery = query.toString();
  const [name, setName] = useState<string>();
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    fetch("/api/auth/oauth2/public-client-prelogin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((client: { client_name?: unknown } | null) => {
        if (
          live &&
          typeof client?.client_name === "string" &&
          client.client_name
        )
          setName(client.client_name);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [clientId, oauthQuery]);
  return name ?? "Your app";
}
