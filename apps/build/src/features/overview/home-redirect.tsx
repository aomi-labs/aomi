"use client";

import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

import { LoadingPanel } from "@/features/deploy/components/deployments/ui/state-panels";
import { platformHref, readPlatform } from "@/features/deploy/platform";
import { DEFAULT_DEPLOY_PLATFORM } from "@/lib/deploy-platform";
import { getLastProjectId } from "@/lib/last-project";

/**
 * Default landing: last project if known, otherwise Projects.
 * Overview stats live at /overview.
 */
export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    const last = getLastProjectId();
    const href = last ? `/projects/${last}` : "/projects";
    router.navigate({
      href: platformHref(href, readPlatform() ?? DEFAULT_DEPLOY_PLATFORM),
      replace: true,
    });
  }, [router]);

  return <LoadingPanel label="Opening projects…" />;
}
