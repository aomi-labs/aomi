"use client";

import { useEffect, useState } from "react";

import { getAgentIcon } from "./agent-map";

export interface AgentIdentityIconProps {
  /** Canonical brand key. Empty deliberately disables curated artwork. */
  brandId?: string;
  name: string;
  abbr?: string;
  /** The package's own icon. Shown only once it has loaded, so a missing one never flashes. */
  imageUrl?: string | null;
  size?: "row" | "detail";
}

/** `src` once it has loaded; null while loading, after a failure or without one. */
function useLoaded(src: string | null | undefined): string | null {
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    const image = new Image();
    image.onload = () => setLoaded(src);
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src]);
  return src && loaded === src ? src : null;
}

function fallbackAbbr(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  return (words[0]?.slice(0, 2) || "?").toUpperCase();
}

export function AgentIdentityIcon({
  brandId,
  name,
  abbr,
  imageUrl,
  size = "row",
}: AgentIdentityIconProps) {
  const image = useLoaded(imageUrl);
  // `undefined` supports older hand-built callers. An empty brand is an
  // intentional custom-agent boundary and must never fall back to the wire name.
  const Icon = getAgentIcon(brandId === undefined ? name : brandId);
  const detail = size === "detail";

  return (
    <span
      title={name}
      aria-label={name}
      className={`border-aomi-overlay-border bg-aomi-surface-2 text-aomi-accent flex shrink-0 items-center justify-center overflow-hidden rounded-xl border ${
        detail ? "size-12" : "size-9"
      }`}
    >
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : Icon ? (
        <Icon aria-hidden="true" className={detail ? "size-7" : "size-5"} />
      ) : (
        <span
          aria-hidden="true"
          className={`${detail ? "text-sm" : "text-[11px]"} font-semibold tracking-[-0.04em]`}
        >
          {abbr?.trim() || fallbackAbbr(name)}
        </span>
      )}
    </span>
  );
}
