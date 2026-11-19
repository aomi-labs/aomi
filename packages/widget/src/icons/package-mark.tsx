import { useEffect, useState } from "react";
import { PackageIcon } from "lucide-react";

import { cn } from "@/lib/cn";

const failed = new Set<string>();

/** The icon url once it is known to load; null while unknown-bad or failed. */
function useIcon(iconUrl?: string | null): string | null {
  const [bad, setBad] = useState(() => !!iconUrl && failed.has(iconUrl));
  useEffect(() => {
    if (!iconUrl || failed.has(iconUrl)) {
      setBad(!!iconUrl);
      return;
    }
    setBad(false);
    const img = new Image();
    img.onerror = () => {
      failed.add(iconUrl);
      setBad(true);
    };
    img.src = iconUrl;
  }, [iconUrl]);
  return iconUrl && !bad ? iconUrl : null;
}

/**
 * A package's icon: the SVG its bundle ships (`icon_url`), drawn as a CSS mask
 * in `currentColor`, else the generic package glyph. The one way the UI draws
 * a package; the release check holds the SVG to a square shape in
 * `currentColor`, so only its silhouette matters here. It has no colour of its
 * own: the surface around it decides, as the curated marks did (accent in the
 * Library tile and a sent tag, muted in the picker, grey in trace chips).
 */
export function PackageMark({
  iconUrl,
  className,
}: {
  iconUrl?: string | null;
  className?: string;
}) {
  const url = useIcon(iconUrl);
  if (!url) {
    return (
      <PackageIcon aria-hidden="true" className={cn("shrink-0", className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-package-icon={url}
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        maskImage: `url(${JSON.stringify(url)})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}

/**
 * A package's mark in a Library row (32px) or detail header (48px): its own
 * icon on a plain tile with a hairline, else the accent package glyph on the
 * accent-subtle tile.
 */
export function PackageTile({
  iconUrl,
  size = "row",
}: {
  iconUrl?: string | null;
  size?: "row" | "detail";
}) {
  const detail = size === "detail";
  const url = useIcon(iconUrl);
  return (
    <span
      className={cn(
        "text-aomi-accent-strong flex shrink-0 items-center justify-center",
        url
          ? "border-aomi-border bg-aomi-raised border"
          : "bg-aomi-accent-subtle",
        detail ? "size-12 rounded-xl" : "rounded-control size-8",
      )}
    >
      <PackageMark iconUrl={url} className={detail ? "size-6" : "size-4"} />
    </span>
  );
}
