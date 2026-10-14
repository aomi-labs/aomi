import { useCallback, useMemo } from "react";
import {
  useLocation,
  useRouter as useTanStackRouter,
} from "@tanstack/react-router";

export function usePathname() {
  return useLocation({ select: (location) => location.pathname });
}

export function useSearchParams() {
  const search = useLocation({ select: (location) => location.searchStr });
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useRouter() {
  const router = useTanStackRouter();
  return useMemo(
    () => ({
      replace: (href: string) => router.navigate({ href, replace: true }),
    }),
    [router],
  );
}

/** Router owns browser history; the chat runtime owns the active conversation. */
export function usePortalUrlNavigation() {
  const router = useTanStackRouter();
  const { href, searchStr } = useLocation();
  const replace = useCallback(
    (url: URL) =>
      router.navigate({
        href: url.pathname + url.search + url.hash,
        replace: true,
      }),
    [router],
  );
  const push = useCallback(
    (url: URL) =>
      router.navigate({ href: url.pathname + url.search + url.hash }),
    [router],
  );
  return useMemo(
    () => ({ href, search: searchStr, replace, push }),
    [href, searchStr, replace, push],
  );
}
