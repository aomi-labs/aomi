/** Models preferred as default, in priority order. */
const PREFERRED_DEFAULT_MODEL_PATTERNS: RegExp[] = [
  /^gpt-5\.6[- ]terra/i,
  /^claude.*opus.*4[.-]?8/i,
  /^claude.*4[.-]?8.*opus/i,
  /^claude.*opus.*4[.-]?6/i,
  /^claude.*4[.-]?6.*opus/i,
  /^claude-4\.5-haiku/i,
  /^claude.*haiku/i,
  /^gpt-4o-mini/i,
  /^gemini.*flash/i,
];

/**
 * Resolve the actual backend model for auto mode.
 * Prefers the current auto model before falling back to older balanced defaults
 * and then backend order.
 */
export function resolveAutoModel(models: string[]): string | null {
  if (models.length === 0) return null;

  for (const pattern of PREFERRED_DEFAULT_MODEL_PATTERNS) {
    const match = models.find((model) => pattern.test(model));
    if (match) return match;
  }

  return models[0] ?? null;
}
