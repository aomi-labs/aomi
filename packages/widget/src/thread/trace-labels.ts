import type { InterpretedToolStep, ToolChip } from "@aomi-labs/client/trace";

/** The model's own short topic for a call, written into its arguments. */
export function stepTopic(argsText: string | undefined): string | undefined {
  if (!argsText) return undefined;
  try {
    const topic = (JSON.parse(argsText) as { topic?: unknown } | null)?.topic;
    return typeof topic === "string" && topic.trim() ? topic.trim() : undefined;
  } catch {
    return undefined;
  }
}

const PAST: Record<string, string> = {
  activate: "Activated",
  add: "Added",
  call: "Called",
  check: "Checked",
  commit: "Committed",
  compare: "Compared",
  confirm: "Confirmed",
  derive: "Derived",
  estimate: "Estimated",
  fetch: "Fetched",
  find: "Looked for",
  get: "Got",
  identify: "Identified",
  inspect: "Inspected",
  list: "Listed",
  load: "Loaded",
  look: "Looked",
  prepare: "Prepared",
  quote: "Quoted",
  read: "Read",
  request: "Requested",
  resolve: "Resolved",
  review: "Asked you to review",
  search: "Searched",
  searching: "Searched",
  send: "Sent",
  sign: "Signed",
  simulate: "Simulated",
  stage: "Staged",
  verify: "Verified",
};

const past = (text: string): string => {
  const [first = "", ...rest] = text.split(" ");
  const verb = PAST[first.toLowerCase()];
  return verb ? [verb, ...rest].join(" ") : text;
};

export function stepLabel(
  step: InterpretedToolStep,
  options: { topic?: string; toolName?: string; done: boolean },
): string {
  const packages = step.chips
    .filter((chip) => chip.packageId)
    .map((chip) => chip.label);
  if (options.toolName?.endsWith("activate_package") && packages.length > 0)
    return options.done
      ? `Activated ${packages.join(" and ")}`
      : `Activate ${packages.join(" and ")}`;
  const text =
    options.topic && options.topic !== options.toolName
      ? options.topic
      : step.title;
  return options.done ? past(text) : text;
}

const lowerFirst = (text: string) =>
  text.slice(0, 1).toLowerCase() + text.slice(1);

/** One line for several steps: what mattered first, then the rest. */
export function burstSummary(labels: readonly string[]): string {
  const unique = [...new Set(labels)];
  const rank = (label: string) =>
    /^(Prepared|Staged|Simulated|Asked|Requested)/.test(label)
      ? 0
      : /^(Activated|Got)/.test(label)
        ? 2
        : 1;
  const sorted = [...unique].sort((a, b) => rank(a) - rank(b));
  const [first = "", second, third] = sorted;
  if (!second) return first;
  if (sorted.length === 3 && third && sorted.join(", ").length < 80)
    return `${first}, ${lowerFirst(second)} and ${lowerFirst(third)}`;
  const verb = first.split(" ")[0];
  const both =
    verb === second.split(" ")[0] && Object.values(PAST).includes(verb!)
      ? `${first} and ${second.split(" ").slice(1).join(" ")}`
      : `${first}, ${lowerFirst(second)}`;
  // Too long for one line: the count beside it says there is more.
  return both.length > 72 ? first : both;
}

const VERBS = new RegExp(
  `(^|, | and )(${[...new Set(Object.values(PAST))]
    .sort((a, b) => b.length - a.length)
    .join("|")})(?= )`,
  "gi",
);

/** Splits a line into quiet words (verbs) and the subject that stands out. */
export function labelParts(text: string): { text: string; quiet: boolean }[] {
  const parts: { text: string; quiet: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(VERBS)) {
    if (match.index > at)
      parts.push({ text: text.slice(at, match.index), quiet: false });
    parts.push({ text: match[0], quiet: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), quiet: false });
  return parts;
}

export const noise = (label: string): boolean =>
  /^0x|…/.test(label) ||
  /^[\d,]{9,}$/.test(label) ||
  /^Top \d+/.test(label) ||
  /^1 tx$/.test(label) ||
  /^[a-zA-Z_]+_[a-zA-Z_]+$/.test(label) ||
  /^[A-Z_a-z]{16,}$/.test(label);

/** The pills that say something the line does not already say. */
export function linePills(
  chips: readonly ToolChip[],
  label: string,
  limit: number,
): ToolChip[] {
  const said = label.toLowerCase();
  const seen = new Map<string, ToolChip>();
  for (const chip of chips) {
    if (!chip.icon || chip.attribution || noise(chip.label)) continue;
    if (["code", "contract", "failed"].includes(chip.icon)) continue;
    if (/^0 /.test(chip.label) || said.includes(chip.label.toLowerCase()))
      continue;
    seen.set(chip.label, chip);
  }
  return [...seen.values()].slice(0, limit);
}

const SHORT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/**
 * An amount as a pill shows it: `14150730.625254 USDC` reads `14.15M USDC`.
 * Display only; the exact text stays on hover. Never rounds to zero.
 */
export function shortAmount(label: string): string {
  const match =
    /^([<>~≈]?\s?[-+]?\$?)(\d[\d,]*)(\.\d+)?(\s+[A-Za-z][\w.+-]*|%)?$/.exec(
      label,
    );
  if (!match) return label;
  const [, lead = "", whole = "", fraction = "", unit = ""] = match;
  const value = Number(whole.replaceAll(",", "") + fraction);
  // Plain counts, years and ids stay as written.
  if (!Number.isFinite(value) || (!fraction && value < 1e6)) return label;
  if (!fraction && !unit && !lead) return label;
  const text =
    value >= 1e6
      ? SHORT.format(value)
      : value >= 1_000
        ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : value >= 1
          ? value.toLocaleString("en-US", { maximumFractionDigits: 4 })
          : value === 0
            ? "0"
            : value < 1e-9
              ? value.toExponential(2)
              : value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return `${lead}${text}${unit}`;
}
