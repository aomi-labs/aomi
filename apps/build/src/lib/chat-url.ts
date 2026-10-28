/**
 * The chat host: NEXT_PUBLIC_CHAT_URL, which the build defaults to
 * chat.aomi.dev in production and chat-staging.aomi.dev everywhere else.
 */
export function resolveChatUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CHAT_URL?.trim() || "https://chat-staging.aomi.dev"
  );
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
