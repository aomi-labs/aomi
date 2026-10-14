/** What a chat without a title reads as. Display only: never stored as a title. */
export const DEFAULT_THREAD_TITLE = "New Chat";

export const isPlaceholderTitle = (title?: string) => {
  const normalized = title?.trim() ?? "";
  return !normalized || normalized.startsWith("#[");
};

/** No real title yet: empty, a placeholder, or the default label (which the
 * backend also uses until it generates one). */
export const isGenericTitle = (title?: string) =>
  isPlaceholderTitle(title) || title?.trim() === DEFAULT_THREAD_TITLE;

/** Automatic server titles must not erase a useful local request fallback.
 * Explicit Rename applies directly and can still choose "New Chat". */
export const reconcileGeneratedThreadTitle = (
  current: string | undefined,
  incoming: string | undefined,
) => {
  if (isGenericTitle(incoming) && !isGenericTitle(current)) return current!;
  return incoming ?? current ?? "";
};
