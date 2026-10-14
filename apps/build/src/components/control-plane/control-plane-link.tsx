"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ComponentProps } from "react";

import { useGitHubSession } from "./github-session-context";
import { prefetchControlPlaneRoute } from "./prefetch-control-plane-route";
import { githubAccountKey } from "@/features/deploy/query-keys";

type ControlPlaneLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "prefetch"
> & {
  href: string;
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
    const dataPrefetched = prefetchControlPlaneRoute(
      queryClient,
      href,
      githubAccountKey(account.githubLogin),
    );
    if (!dataPrefetched) router.prefetch(href);
  };

  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
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
