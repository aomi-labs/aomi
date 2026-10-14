/**
 * Default chat host for the current deploy environment: production uses the
 * canonical chat.aomi.dev, while previews (staging) and local dev target
 * chat-staging.aomi.dev.
 */
export function defaultChatUrl(): string {
  const vercelEnv =
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    (typeof process !== "undefined" ? process.env.VERCEL_ENV : undefined);
  if (vercelEnv === "production") {
    return "https://chat.aomi.dev";
  }
  return "https://chat-staging.aomi.dev";
}

/**
 * Resolves the base chat URL from the NEXT_PUBLIC_CHAT_URL env var.
 * Falls back to the environment-appropriate chat host when the env is not set.
 */
export function resolveChatUrl(): string {
  return process.env.NEXT_PUBLIC_CHAT_URL?.trim() || defaultChatUrl();
}

/**
 * Returns the deep-link URL for a specific app in the chat UI.
 * @param appName - The app identifier to open in chat.
 */
export function chatAppUrl(
  appName: string,
  options: { locked?: boolean; applicationId?: number | string | null } = {},
): string {
  const base = resolveChatUrl();
  const params = new URLSearchParams({ app: appName });
  const applicationId = options.applicationId?.toString().trim();
  if (applicationId) params.set("application_id", applicationId);
  if (options.locked) params.set("lock_app", "1");
  return `${base}?${params.toString()}`;
}
