"use client";

import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";

import { DEFAULT_DEPLOY_PLATFORM } from "@/lib/deploy-platform";
import { readPlatform, writePlatform } from "./platform";

/**
 * The active platform. The URL wins — it is what the page actually rendered
 * against — and visiting a platform-scoped page makes that platform sticky.
 * With nothing in the URL or storage the answer is Community: Build has no
 * unscoped view.
 *
 */
export function usePlatform(): string {
  const search = useLocation({ select: (location) => location.searchStr });
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(search).get("platform")?.trim() || null;
    if (fromUrl) writePlatform(fromUrl);
    setPlatform(fromUrl ?? readPlatform());
  }, [search]);

  return platform ?? DEFAULT_DEPLOY_PLATFORM;
}
