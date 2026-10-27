/** Cookie reading and writing without a framework jar. */

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const value = trimmed.slice(name.length + 1).trim();
    return value ? value : undefined;
  }
  return undefined;
}

export type CookieOptions = {
  secure: boolean;
  /** Seconds; 0 deletes the cookie. */
  maxAge: number;
};

/** An HttpOnly, Lax, path=/ cookie: the only shape Build's session cookies take. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
  ];
  if (options.maxAge <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function appendCookie(response: Response, cookie: string): void {
  response.headers.append("set-cookie", cookie);
}
