"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@aomi-labs/widget/browser-auth";
import {
  ConnectionMark,
  FootnoteLink,
} from "@aomi-labs/widget/host-composition";
import { StandalonePage } from "@/components/shell/standalone-page";
import { useOAuthClientName } from "../oauth-client-name";

/**
 * Better Auth's login page for an OAuth client (MCP or SDK): the wallet picker
 * with the client's purpose, then back to the authorize request.
 */
export function OAuthAuthorizeClient() {
  const params = useSearchParams();
  const name = useOAuthClientName(params);
  const query = params.toString();
  useEffect(() => {
    if (params.get("client_id")) sessionStorage.setItem(STASH_KEY, query);
  }, [params, query]);
  return (
    <StandalonePage
      purpose={{
        icon: <ConnectionMark kind="app" name={name} size={16} />,
        text: `To connect ${name} to your account`,
      }}
      footnote={
        <FootnoteLink
          onClick={() =>
            void authClient.signIn.anonymous().then((result) => {
              if (!result.error) resume(query);
            })
          }
        >
          Continue as guest
        </FootnoteLink>
      }
    >
      <Resume query={query} />
    </StandalonePage>
  );
}

const STASH_KEY = "aomi.oauth.authorize.query";

/** Back to the authorize request, with the query a login redirect may have rewritten. */
function resume(query: string) {
  const stashed = sessionStorage.getItem(STASH_KEY) ?? query;
  sessionStorage.removeItem(STASH_KEY);
  window.location.replace(`/api/auth/oauth2/authorize?${stashed}`);
}

/** Signed in: finish the authorize request. */
function Resume({ query }: { query: string }) {
  useEffect(() => resume(query), [query]);
  return null;
}
