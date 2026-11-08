/**
 * Fields of a Client ID Metadata Document whose URLs must share the
 * `client_id` origin.
 *
 * `@better-auth/cimd` also binds `client_uri` by default. We don't, because
 * real clients host the document on one origin and their homepage on another:
 * Hermes Agent publishes its document on `nousresearch.github.io` and names
 * `hermes-agent.nousresearch.com` as its `client_uri`, so every Hermes MCP
 * login was refused with `invalid_client` before reaching the consent page.
 *
 * `client_uri` is informational. Our consent and device pages show only
 * `client_name`, and nothing routes or redirects to `client_uri`, so leaving it
 * unbound grants no capability. Post-logout redirects still move the browser,
 * so they stay bound. Authorization redirect URIs are matched exactly at
 * authorize time and are not origin-bound by the plugin either way.
 */
export const CIMD_ORIGIN_BOUND_FIELDS = ["post_logout_redirect_uris"] as const;
