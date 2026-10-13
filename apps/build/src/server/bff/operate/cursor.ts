import "@tanstack/react-start/server-only";

export function pageLimit(
  params: URLSearchParams,
  fallback: number,
  max: number,
) {
  const value = Number(params.get("limit") ?? String(fallback));
  return Number.isSafeInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

export type CompositeCursor = {
  /** Per-source cursors from the fallback fan-out. */
  perSource?: Record<string, unknown>;
  /** The batch endpoints paginate the merged stream with one global cursor. */
  batch?: unknown;
};

export function parseCompositeCursor(
  value: string | null,
): CompositeCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CompositeCursor;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function sourceCursor(
  cursor: CompositeCursor | null,
  projectId: number,
): unknown | undefined {
  return cursor?.perSource?.[String(projectId)];
}

export function mergedNextCursor<T extends { project: { id: number } }>(
  previous: CompositeCursor | null,
  visible: T[],
  allRows: T[],
  results: Array<{ nextCursor: unknown }>,
  cursorFor: (row: T) => unknown,
): CompositeCursor | null {
  const hasMore =
    allRows.length > visible.length ||
    results.some((result) => result.nextCursor != null);
  if (!hasMore) return null;
  const perSource: Record<string, unknown> = {
    ...(previous?.perSource ?? {}),
  };
  for (const row of visible) {
    perSource[String(row.project.id)] = cursorFor(row);
  }
  return { perSource };
}
