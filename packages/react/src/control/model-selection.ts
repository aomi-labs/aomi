/** Models preferred as default, in priority order. */
const PREFERRED_DEFAULT_MODEL_PATTERNS: RegExp[] = [
  /^gpt[- ]?6\.1[- ]sol$/i,
  /^gpt[- ]?6[- ]sol/i,
  /^claude.*opus.*4[.-]?8/i,
  /^claude.*4[.-]?8.*opus/i,
  /^claude.*opus.*4[.-]?6/i,
  /^claude.*4[.-]?6.*opus/i,
  /^claude-4\.5-haiku/i,
  /^claude.*haiku/i,
  /^gpt-4o-mini/i,
  /^gemini.*flash/i,
];

/** Recover a saved supplier route using the same model in today's catalog. */
export function resolveCatalogModel(
  selected: string | null,
  models: string[],
): string | null {
  if (!selected) return null;
  if (models.includes(selected)) return selected;
  const name = (model: string) =>
    model
      .replace(/^(?:anthropic|openai|openrouter|blockrun):/, "")
      .split("/")
      .at(-1)!
      .replace(/^(claude-[a-z]+-\d+)\.(\d+)$/, "$1-$2");
  return models.find((model) => name(model) === name(selected)) ?? null;
}

/**
 * Resolve the actual backend model for auto mode.
 * Prefers the current auto model before falling back to older balanced defaults
 * and then backend order.
 */
export function resolveAutoModel(models: string[]): string | null {
  if (models.length === 0) return null;

  for (const pattern of PREFERRED_DEFAULT_MODEL_PATTERNS) {
    const match = models.find((model) =>
      pattern.test(model.split(":").at(-1) ?? model),
    );
    if (match) return match;
  }

  return models[0] ?? null;
}
