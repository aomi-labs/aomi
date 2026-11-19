import { PackageIcon } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A package's icon: the SVG its bundle ships (`icon_url`), drawn as a CSS mask
 * in the text colour, else the generic package glyph. The one way the UI
 * draws a package; the release check holds the SVG to a square shape in
 * `currentColor`, so only its silhouette matters here. Accent by default; a
 * caller's `text-*` class overrides it (trace and sidebar chips are neutral).
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
      <PackageIcon
        aria-hidden="true"
        className={cn("text-aomi-accent shrink-0", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-package-icon={iconUrl}
      className={cn(
        "text-aomi-accent inline-block shrink-0 bg-current",
        className,
      )}
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
        "border-aomi-overlay-border bg-aomi-surface-2 flex shrink-0 items-center justify-center rounded-xl border",
        detail ? "size-12" : "size-9",
      )}
    >
      <PackageMark iconUrl={iconUrl} className={detail ? "size-7" : "size-5"} />
    </span>
  );
}
