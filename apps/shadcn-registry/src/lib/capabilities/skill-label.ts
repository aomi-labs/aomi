/** Keep routing IDs intact; only the final segment is a display label. */
export function skillLabel(skill: { name: string }): string {
  const name = skill.name.split("/").pop() ?? skill.name;
  if (name.toLowerCase() === "lifi_swap") return "LI.FI";

  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
