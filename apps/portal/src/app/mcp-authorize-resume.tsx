"use client";

import { useEffect } from "react";
import { authClient } from "@aomi-labs/account/better-auth/client";

const STASH_KEY = "aomi.mcp.authorize.query";

/**
 * Resume an MCP OAuth authorize request after login. better-auth's `mcp`
 * plugin redirects unauthenticated authorize calls to the portal root with
 * the original query attached; the portal is the login page, so once a
 * session exists we send the browser back to the authorize endpoint to
 * finish consent and redirect to the MCP client's callback.
 */
export function McpAuthorizeResume() {
  const { data } = authClient.useSession();

  // Stash the authorize query on first paint — login flows may rewrite the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("response_type") === "code" && params.get("client_id")) {
      sessionStorage.setItem(STASH_KEY, window.location.search);
    }
  }, []);

  useEffect(() => {
    if (!data?.session) return;
    const query = sessionStorage.getItem(STASH_KEY);
    if (!query) return;
    sessionStorage.removeItem(STASH_KEY);
    window.location.replace(`/api/auth/mcp/authorize${query}`);
  }, [data?.session]);

  return null;
}
