import { PackageIcon } from "lucide-react";

import { cn } from "@/lib/cn";

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
  if (!iconUrl) {
    return (
      <PackageIcon aria-hidden="true" className={cn("shrink-0", className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-package-icon={iconUrl}
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        maskImage: `url(${JSON.stringify(iconUrl)})`,
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
  return (
    <span
      className={cn(
        "text-aomi-accent-strong flex shrink-0 items-center justify-center",
        iconUrl
          ? "border-aomi-border bg-aomi-raised border"
          : "bg-aomi-accent-subtle",
        detail ? "size-12 rounded-xl" : "rounded-control size-8",
      )}
    >
      <PackageMark iconUrl={iconUrl} className={detail ? "size-6" : "size-4"} />
    </span>
  );
}
