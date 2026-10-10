export function oauthConsentRedirect(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const response = body as Record<string, unknown>;
  return response.redirect === true &&
    typeof response.url === "string" &&
    response.url.length > 0
    ? response.url
    : null;
}
