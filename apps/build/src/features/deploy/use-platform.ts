"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { DEFAULT_DEPLOY_PLATFORM } from "@build/lib/deploy-platform";
import { readPlatform, writePlatform } from "./platform";

/**
 * The active platform. The URL wins — it is what the page actually rendered
 * against — and visiting a platform-scoped page makes that platform sticky.
 * With nothing in the URL or storage the answer is Community: Build has no
 * unscoped view.
 *
 * Reads `window.location` rather than `useSearchParams` so the shell does not
 * need a Suspense boundary to stay statically renderable.
 */
export function usePlatform(): string {
  const pathname = usePathname();
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl =
      new URLSearchParams(window.location.search).get("platform")?.trim() ||
      null;
    if (fromUrl) writePlatform(fromUrl);
    setPlatform(fromUrl ?? readPlatform());
  }, [pathname]);

  return platform ?? DEFAULT_DEPLOY_PLATFORM;
}
