/**
 * Model metadata for UI display.
 * Maps raw backend model strings to vendor info and grouping hints.
 */

export { resolveAutoModel } from "@aomi-labs/react";

// =============================================================================
// Vendor definitions
// =============================================================================

export type VendorInfo = {
  id: string;
  label: string;
  /** 1-2 letter abbreviation for the avatar fallback */
  abbr: string;
};

const VENDORS: Record<string, VendorInfo> = {
  anthropic: { id: "anthropic", label: "Anthropic", abbr: "A" },
  openai: { id: "openai", label: "OpenAI", abbr: "O" },
  google: { id: "google", label: "Google", abbr: "G" },
  meta: { id: "meta", label: "Meta", abbr: "M" },
  mistral: { id: "mistral", label: "Mistral", abbr: "Mi" },
  deepseek: { id: "deepseek", label: "DeepSeek", abbr: "D" },
  xai: { id: "xai", label: "xAI", abbr: "X" },
  cohere: { id: "cohere", label: "Cohere", abbr: "C" },
  glm: { id: "glm", label: "GLM", abbr: "G" },
  moonshot: { id: "moonshot", label: "Moonshot AI", abbr: "K" },
  unknown: { id: "unknown", label: "Other", abbr: "?" },
};

// =============================================================================
// Vendor detection from model string
// =============================================================================

const VENDOR_PATTERNS: [RegExp, string][] = [
  [/^claude/i, "anthropic"],
  [/^gpt|^o[1-9]|^chatgpt|^dall-e/i, "openai"],
  [/^gemini|^palm/i, "google"],
  [/^llama|^meta-llama/i, "meta"],
  [/^mistral|^mixtral|^codestral|^pixtral/i, "mistral"],
  [/^deepseek/i, "deepseek"],
  [/^grok/i, "xai"],
  [/^command/i, "cohere"],
  [/^glm|^chatglm|^zai|^z\.ai|^zhipu/i, "glm"],
  [/^kimi|^moonshot/i, "moonshot"],
];

export function getVendorForModel(model: string): VendorInfo {
  const lower = modelName(model).toLowerCase();
  for (const [pattern, vendorId] of VENDOR_PATTERNS) {
    if (pattern.test(lower)) {
      return VENDORS[vendorId]!;
    }
  }
  return VENDORS.unknown!;
}

const WORD_CASE: Record<string, string> = {
  deepseek: "DeepSeek",
  gpt: "GPT",
  glm: "GLM",
};

/**
 * A model id as people read it. The backend lists supplier routes
 * (`anthropic:claude-opus-5-5`, `openrouter:moonshotai/kimi-k2.6`); the id
 * itself is what gets selected, this is display only.
 */
export function modelLabel(model: string): string {
  const name = modelName(model).replace(
    /^(deepseek-v[\d.]+-(?:flash|pro))-\d{4}$/i,
    "$1",
  );
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)$/i.exec(name);
  if (claude)
    return `Claude ${capitalize(claude[1]!)} ${claude[2]}.${claude[3]}`;
  // `gpt-6.1-sol` → `GPT-6.1 Sol`, `glm-5.2` → `GLM-5.2`: the version stays joined.
  const versioned = /^(gpt|glm)-([\d.]+)(?:-(.+))?$/i.exec(name);
  if (versioned)
    return [
      `${versioned[1]!.toUpperCase()}-${versioned[2]}`,
      ...words(versioned[3] ?? ""),
    ].join(" ");
  return words(name).join(" ");
}

function modelName(model: string): string {
  return model
    .replace(/^(?:anthropic|openai|openrouter|blockrun):/i, "")
    .split("/")
    .at(-1)!
    .replace(/^~/, "")
    .replace(/-latest$/, "");
}

function words(name: string): string[] {
  return name
    .split("-")
    .filter(Boolean)
    .map((word) => WORD_CASE[word.toLowerCase()] ?? capitalize(word));
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// =============================================================================
// Group models by vendor, sorted
// =============================================================================

export type ModelGroup = {
  vendor: VendorInfo;
  models: string[];
};

export function groupModelsByVendor(models: string[]): ModelGroup[] {
  const grouped = new Map<string, string[]>();

  for (const model of models) {
    const vendor = getVendorForModel(model);
    const existing = grouped.get(vendor.id) ?? [];
    existing.push(model);
    grouped.set(vendor.id, existing);
  }

  // Sort vendor groups alphabetically by label
  return Array.from(grouped.entries())
    .map(([vendorId, vendorModels]) => ({
      vendor: VENDORS[vendorId] ?? VENDORS.unknown!,
      models: [...vendorModels].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      ),
    }))
    .sort((a, b) => {
      if (a.vendor.id === "unknown") return 1;
      if (b.vendor.id === "unknown") return -1;
      return a.vendor.label.localeCompare(b.vendor.label);
    });
}

// =============================================================================
// Automatic model selection
// =============================================================================

/** The display label shown when automatic model selection is active. */
export const AUTO_MODEL_LABEL = "Auto";
export const AUTO_MODEL_DESCRIPTION = "Picks a model per task";
