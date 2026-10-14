"use client";

import {
  UrlLink as Link,
  urlLinkOptions,
  type UrlLinkProps,
} from "@/components/url-link";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { useGitHubSession } from "./github-session-context";
import { prefetchControlPlaneRoute } from "./prefetch-control-plane-route";
import { githubAccountKey } from "@/features/deploy/query-keys";

type ControlPlaneLinkProps = Omit<UrlLinkProps, "preload"> & {
  warmOnIntent?: boolean;
};

export function ControlPlaneLink({
  href,
  warmOnIntent = true,
  onMouseEnter,
  onFocus,
  ...props
}: ControlPlaneLinkProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { account } = useGitHubSession();

  const warmRoute = () => {
    if (!warmOnIntent) return;
    prefetchControlPlaneRoute(
      queryClient,
      href,
      githubAccountKey(account.githubLogin),
    );
    void router.preloadRoute(urlLinkOptions(href));
  };

  return (
    <Link
      {...props}
      href={href}
      preload={false}
      onMouseEnter={(event) => {
        warmRoute();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        warmRoute();
        onFocus?.(event);
      }}
    />
  );
}
