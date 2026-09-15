/** Opt-in local UI development against an existing Portal BFF. Never active in deployed builds. */
export function hostedPortalOrigin(): string {
  if (process.env.NODE_ENV !== "development") return "";
  const value = process.env.NEXT_PUBLIC_AOMI_HOSTED_PORTAL_URL?.trim();
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("Hosted Portal must use HTTPS");
  return url.origin;
}

export function hostedPortalApiOrigin(): string {
  return hostedPortalOrigin() && typeof window !== "undefined"
    ? window.location.origin
    : "";
}
