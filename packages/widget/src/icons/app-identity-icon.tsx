import { getAppIcon } from "./app-map";

export interface AppIdentityIconProps {
  /** Canonical brand key. Empty deliberately disables curated artwork. */
  brandId?: string;
  name: string;
  abbr?: string;
  size?: "row" | "detail";
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

export function AppIdentityIcon({
  brandId,
  name,
  abbr,
  size = "row",
}: AppIdentityIconProps) {
  // `undefined` supports older hand-built callers. An empty brand is an
  // intentional custom-app boundary and must never fall back to the wire name.
  const Icon = getAppIcon(brandId === undefined ? name : brandId);
  const detail = size === "detail";

  return (
    <span
      title={name}
      aria-label={name}
      className={`border-aomi-overlay-border bg-aomi-surface-2 text-aomi-accent flex shrink-0 items-center justify-center rounded-xl border ${
        detail ? "size-12" : "size-9"
      }`}
    >
      {Icon ? (
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
