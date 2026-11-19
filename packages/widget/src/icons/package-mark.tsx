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

/** A package's icon in the soft tile of a Library row or detail header. */
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
        "border-aomi-overlay-border bg-aomi-surface-2 text-aomi-accent flex shrink-0 items-center justify-center rounded-xl border",
        detail ? "size-12" : "size-9",
      )}
    >
      <PackageMark iconUrl={iconUrl} className={detail ? "size-7" : "size-5"} />
    </span>
  );
}
