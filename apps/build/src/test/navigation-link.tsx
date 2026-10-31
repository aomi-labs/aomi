import { createElement, type AnchorHTMLAttributes } from "react";

/** Unit tests exercise their feature without requiring a route tree. */
export function TestNavigationLink({
  to,
  href,
  preload: _preload,
  params: _params,
  search: _search,
  hash: _hash,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  to?: string;
  preload?: unknown;
  params?: unknown;
  search?: unknown;
  hash?: unknown;
}) {
  const params = new URLSearchParams();
  if (_search && typeof _search === "object") {
    for (const [key, value] of Object.entries(_search)) {
      if (Array.isArray(value))
        for (const item of value) params.append(key, String(item));
      else if (value != null) params.append(key, String(value));
    }
  }
  const query = params.toString();
  return createElement("a", {
    ...props,
    href:
      href ??
      `${to === "." ? "" : (to ?? "")}${query ? `?${query}` : ""}${_hash ? `#${_hash}` : ""}`,
  });
}
