/** Sign links (`/sign/:ref`) are login-only. A signed-out visit goes to the
 * portal root, which is the login page, and comes back after sign-in. */
export const SIGN_RETURN_PARAM = "return_to";

export function signPath(ref: string): string {
  return `/sign/${encodeURIComponent(ref)}`;
}

export function signLoginRedirect(ref: string): string {
  return `/?${new URLSearchParams({ [SIGN_RETURN_PARAM]: signPath(ref) })}`;
}

/** Only a same-origin sign page may be a return target; anything else is an
 * open redirect and is dropped. */
export function safeSignReturn(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return /^\/sign\/[A-Za-z0-9_%.~-]+$/.test(value) ? value : null;
}
