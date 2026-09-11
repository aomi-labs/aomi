"use client";

import Link from "next/link";
import { Layers3 } from "lucide-react";

import { usePlatform } from "@build/features/launch/use-platform";

/**
 * Which platform Build is currently pointed at, in the shell top bar.
 *
 * Every scoped page — Projects, Deployments, Overview — renders against one
 * platform, and until now nothing on screen said which one. The badge is the
 * standing answer, and the way into the selector: it links to Settings →
 * General, where {@link PlatformSwitcher} lists the platforms you can reach.
 */
export function PlatformBadge() {
  const platform = usePlatform();

  return (
    <Link
      href="/settings/general"
      aria-label={`Platform: ${platform}. Change platform`}
      title="Change platform"
      className="icon-button border-border hover:bg-accent-hover inline-flex h-8 min-w-0 items-center gap-2 rounded-md border px-2 text-xs transition"
    >
      <Layers3 className="text-dim size-3.5 shrink-0" aria-hidden />
      <span className="text-dim hidden sm:inline">Platform</span>
      <span className="text-foreground max-w-[12rem] truncate font-medium">
        {platform}
      </span>
    </Link>
  );
}
