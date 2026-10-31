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
