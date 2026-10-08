/**
 * The backend an app signs bearers for and forwards to, from its environment.
 * Signing and forwarding must agree, so every caller uses this one order.
 */
export function backendUrlFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): string {
  for (const value of [
    // Remove when scripts/test-browser-contracts.mjs sets BACKEND_URL instead.
    env.AOMI_PROXY_BACKEND_URL,
    env.BACKEND_URL,
    // Hosted portals set only this one; a browser-relative value is skipped.
    env.NEXT_PUBLIC_BACKEND_URL,
  ]) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol))
        return url.toString().replace(/\/+$/, "");
    } catch {
      // Browser-relative path: try the next setting.
    }
  }
  if (env.VERCEL_ENV === "production") return "https://api.aomi.dev";
  if (env.VERCEL_ENV === "preview") return "https://api-staging.aomi.dev";
  return "http://127.0.0.1:8080";
}
