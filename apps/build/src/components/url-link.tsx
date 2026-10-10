import { Link, linkOptions, type LinkProps } from "@tanstack/react-router";
import type { AnchorHTMLAttributes } from "react";
import { parseUrlSearch } from "@/lib/url-search";

export type UrlLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  Pick<LinkProps, "preload" | "replace" | "resetScroll"> & {
    href: string;
  };

/** Adapt the control plane's existing built URLs to Router's route/search model. */
export function urlLinkOptions(href: string) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) {
    return linkOptions({ to: href });
  }
  const hashIndex = href.indexOf("#");
  const pathAndSearch = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const searchIndex = pathAndSearch.indexOf("?");
  const to =
    (searchIndex < 0 ? pathAndSearch : pathAndSearch.slice(0, searchIndex)) ||
    ".";
  return linkOptions({
    to,
    search:
      searchIndex < 0
        ? pathAndSearch
          ? undefined
          : true
        : parseUrlSearch(pathAndSearch.slice(searchIndex)),
    hash: hashIndex < 0 ? "" : href.slice(hashIndex + 1),
  });
}

export function UrlLink({ href, ...props }: UrlLinkProps) {
  return <Link {...props} {...urlLinkOptions(href)} />;
}
