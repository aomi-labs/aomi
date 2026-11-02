import "@tanstack/react-start/server-only";
import { serialize, type CookieSerializeOptions } from "cookie-es";

export function redirectResponse(
  location: string | URL,
  status = 307,
): Response {
  return new Response(null, {
    status,
    headers: { Location: location.toString() },
  });
}

export function appendCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieSerializeOptions,
): void {
  response.headers.append("Set-Cookie", serialize(name, value, options));
}
