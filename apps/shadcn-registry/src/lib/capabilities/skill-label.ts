/** Brand spellings that title-casing the ID would get wrong. */
const BRAND_LABELS: Record<string, string> = {
  common_erc20: "ERC20",
  defillama: "DefiLlama",
  lifi_swap: "LI.FI",
};

/** The brand spelling for a normalized (lowercase, `_`-joined) skill ID. */
export function skillBrandLabel(id: string): string | undefined {
  return Object.hasOwn(BRAND_LABELS, id) ? BRAND_LABELS[id] : undefined;
}

/** Keep routing IDs intact; only the final segment is a display label. */
export function skillLabel(skill: { name: string }): string {
  const name = skill.name.split("/").pop() ?? skill.name;
  const id = name.toLowerCase();
  const brand = skillBrandLabel(id);
  if (brand) return brand;

  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
