/** Compact relative time for deployment history rows. */
export function formatRelativeTime(
  unixSeconds: number,
  nowMs: number = Date.now(),
): string {
  const deltaSec = Math.round((nowMs - unixSeconds * 1000) / 1000);
  if (!Number.isFinite(deltaSec)) return "unknown time";
  if (deltaSec < 45) return "just now";
  if (deltaSec < 90) return "1m ago";
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 5400) return "1h ago";
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)}h ago`;
  if (deltaSec < 172800) return "1d ago";
  if (deltaSec < 86400 * 30) return `${Math.round(deltaSec / 86400)}d ago`;
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
