export const isPlaceholderTitle = (title?: string) => {
  const normalized = title?.trim() ?? "";
  return !normalized || normalized.startsWith("#[");
};

/** Automatic server titles must not erase a useful local request fallback.
 * Explicit Rename applies directly and can still choose "New Chat". */
export const reconcileGeneratedThreadTitle = (
  current: string | undefined,
  incoming: string | undefined,
) => {
  const generic = (value: string | undefined) =>
    isPlaceholderTitle(value) || value?.trim() === "New Chat";
  if (generic(incoming) && !generic(current)) return current!;
  return incoming ?? current ?? "New Chat";
};
