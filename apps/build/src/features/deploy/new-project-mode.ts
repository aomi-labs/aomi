/**
 * How a new app starts: forked from our template, or imported from a GitHub
 * repository the user already has.
 *
 * Lives outside the `"use client"` component so the route can parse `?mode=`
 * on the server and hand the picker its initial card.
 */
export type NewProjectMode = "template" | "import";

/** Read `?mode=` — anything but the two known starts means "let the user pick". */
export function newProjectMode(
  value: string | string[] | undefined,
): NewProjectMode | undefined {
  return value === "template" || value === "import" ? value : undefined;
}
