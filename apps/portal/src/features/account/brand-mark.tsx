"use client";

import type { CSSProperties, SVGProps } from "react";

export type BrandProps = SVGProps<SVGSVGElement> & { size?: number };

/** Fixed brand hex, or per-theme colors for marks that are light-on-dark in brand guidelines. */
export type BrandColor = string | { light: string; dark: string };

export function isThemeBrandColor(color: BrandColor): color is { light: string; dark: string } {
  return typeof color !== "string";
}

/**
 * Renders registry SVG paths with `fill="currentColor"`.
 * Theme-aware marks set CSS vars consumed by `.brand-mark-themed` in globals.css.
 */
export function markup(
  viewBox: string,
  html: string,
  color: BrandColor,
): (props: BrandProps) => React.JSX.Element {
  function Mark({ size = 14, style, className, ...props }: BrandProps) {
    const themed = isThemeBrandColor(color);
    const mergedStyle: CSSProperties = themed
      ? {
          ["--brand-mark-light" as string]: color.light,
          ["--brand-mark-dark" as string]: color.dark,
          ...style,
        }
      : { color, ...style };

    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        aria-hidden="true"
        className={["shrink-0", themed ? "brand-mark-themed" : "", className]
          .filter(Boolean)
          .join(" ")}
        style={mergedStyle}
        dangerouslySetInnerHTML={{ __html: html }}
        {...props}
      />
    );
  }
  return Mark;
}
