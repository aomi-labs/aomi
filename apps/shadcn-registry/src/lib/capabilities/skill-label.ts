/** Brand spellings that title-casing the ID would get wrong. */
const BRAND_LABELS: Record<string, string> = {
  defillama: "DefiLlama",
  lifi_swap: "LI.FI",
};

/** Keep routing IDs intact; only the final segment is a display label. */
export function skillLabel(skill: { name: string }): string {
  const name = skill.name.split("/").pop() ?? skill.name;
  const id = name.toLowerCase();
  if (Object.hasOwn(BRAND_LABELS, id)) return BRAND_LABELS[id];

  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
