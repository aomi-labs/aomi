import { useMemo } from "react";
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
