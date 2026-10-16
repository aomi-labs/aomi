/** Sign links (`/sign/:ref`) and Telegram link pages (`/link/telegram?code=`)
 * are login-only. A signed-out visit goes to the portal root, which is the
 * login page, and comes back after sign-in. */
export const SIGN_RETURN_PARAM = "return_to";

export function signPath(ref: string): string {
  return `/sign/${encodeURIComponent(ref)}`;
}

/** The page a Telegram bot's `/link` button opens. */
export function telegramLinkPath(code: string): string {
  return `/link/telegram?${new URLSearchParams({ code })}`;
}

/** The login page, returning to `path` after sign-in. */
export function loginRedirect(path: string): string {
  return `/?${new URLSearchParams({ [SIGN_RETURN_PARAM]: path })}`;
}

export function signLoginRedirect(ref: string): string {
  return loginRedirect(signPath(ref));
}

const RETURN_TARGETS = [
  /^\/sign\/[A-Za-z0-9_%.~-]+$/,
  /^\/link\/telegram\?code=[A-Za-z0-9_-]{43}$/,
];

/** Only a same-origin sign or Telegram link page may be a return target;
 * anything else is an open redirect and is dropped. */
export function safeReturn(value: string | null | undefined): string | null {
  if (!value) return null;
  return RETURN_TARGETS.some((target) => target.test(value)) ? value : null;
}
