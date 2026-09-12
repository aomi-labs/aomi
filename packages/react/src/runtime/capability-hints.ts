const HINTS_START = "<AOMI_UI_CAPABILITY_HINTS>";
const HINTS_END = "</AOMI_UI_CAPABILITY_HINTS>";

type CapabilityKind = "app" | "skill" | "chain";

export type CapabilityHint = {
  kind: CapabilityKind;
  id: string;
  label?: string;
};

type CapabilityHintEnvelope = {
  capabilities: CapabilityHint[];
  removedApps: CapabilityHint[];
};

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/u;

function parseHint(raw: unknown): CapabilityHint | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  const kind = candidate.kind;
  const id = candidate.id;
  if (
    (kind !== "app" && kind !== "skill" && kind !== "chain") ||
    typeof id !== "string" ||
    !SAFE_ID.test(id)
  ) {
    return null;
  }
  const label =
    typeof candidate.label === "string"
      ? candidate.label
          .replace(/[\r\n<>]/gu, " ")
          .trim()
          .slice(0, 100)
      : undefined;
  return { kind, id, ...(label ? { label } : {}) };
}

function parseEnvelope(raw: unknown): CapabilityHintEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.capabilities)) {
    return null;
  }

  const capabilities = candidate.capabilities
    .map(parseHint)
    .filter((hint): hint is CapabilityHint => hint !== null)
    .slice(0, 16);
  const removedApps = Array.isArray(candidate.removedApps)
    ? candidate.removedApps
        .map(parseHint)
        .filter(
          (hint): hint is CapabilityHint =>
            hint?.kind === "app" &&
            !capabilities.some(
              (selected) => selected.kind === "app" && selected.id === hint.id,
            ),
        )
        .slice(0, 16)
    : [];
  if (capabilities.length === 0 && removedApps.length === 0) return null;
  return { capabilities, removedApps };
}

/**
 * Expand frontend-only capability chips into a bounded model hint. The ids
 * originate in Aomi catalogs, are validated above, and remain preferences —
 * the runtime's existing compatibility and authorization gates still win.
 */
export function appendCapabilityHints(text: string, raw: unknown): string {
  const envelope = parseEnvelope(raw);
  if (!envelope) return text;

  const byKind = (kind: CapabilityKind) =>
    envelope.capabilities
      .filter((hint) => hint.kind === kind)
      .map((hint) => hint.id);
  const apps = byKind("app");
  const skills = byKind("skill");
  const chains = byKind("chain");
  const lines = [
    HINTS_START,
    "These are capability preferences selected by the user in the Aomi UI.",
  ];
  if (apps.length > 0) lines.push(`Preferred app ids: ${apps.join(", ")}.`);
  for (const hint of envelope.capabilities.filter(
    (hint) => hint.kind === "app",
  )) {
    lines.push(
      `User selected app: ${hint.label ?? hint.id}. Use this app for relevant work; do not silently substitute another app.`,
    );
  }
  for (const hint of envelope.removedApps) {
    lines.push(
      `User removed app selection: ${hint.label ?? hint.id} (${hint.id}). Avoid using this app for this turn. This removal guidance applies only to this turn.`,
    );
  }
  for (const id of apps) {
    const applicationId = /^application:[1-9][0-9]*$/u.test(id)
      ? Number(id.slice("application:".length))
      : NaN;
    const target =
      Number.isSafeInteger(applicationId) && applicationId > 0
        ? { application_id: applicationId }
        : id.startsWith("name:") && SAFE_ID.test(id.slice(5))
          ? { app: id.slice(5) }
          : null;
    if (!target) continue;
    lines.push(`Selected app task target: ${JSON.stringify(target)}`);
  }
  if (lines.some((line) => line.startsWith("Selected app task target:"))) {
    lines.push(
      "For work addressed to a selected app, including requests to list its tools, call `task` with a work order in `tasks` using that target and the user's request as `prompt`.",
      "App-specific tools are loaded in the selected child, not in your own tool list. Do not infer app availability from your own tool list; report an actual task failure if the selected app cannot be loaded. Existing authorization and compatibility checks still apply.",
    );
  }
  if (skills.length > 0) {
    lines.push(`Preferred skill ids: ${skills.join(", ")}.`);
    lines.push(
      "Use compatible preferred skills where they help solve the request.",
    );
  }
  if (chains.length > 0) {
    lines.push(`Preferred execution chain ids: ${chains.join(", ")}.`);
  }
  lines.push(
    "App selections guide relevant delegation, not unrelated work. Authorization and compatibility checks still apply. If a selected app fails, report the failure and any verified partial results; offer alternatives without silently substituting another app.",
    HINTS_END,
  );
  return `${text.trimEnd()}\n\n${lines.join("\n")}`;
}

/** Keep the model-only hint out of optimistic and durable user bubbles. */
export function stripCapabilityHints(text: string): string {
  const start = text.lastIndexOf(`\n\n${HINTS_START}`);
  if (start < 0) return text;
  const suffix = text.slice(start + 2);
  if (!suffix.endsWith(HINTS_END)) return text;
  return text.slice(0, start).trimEnd();
}

const HINT_LINES = [
  ["app", "Preferred app ids: "],
  ["skill", "Preferred skill ids: "],
  ["chain", "Preferred execution chain ids: "],
] as const satisfies readonly (readonly [CapabilityKind, string])[];

/** Recover the validated capability identities used by a user message. */
export function extractCapabilityHints(text: string): CapabilityHint[] {
  const start = text.lastIndexOf(`\n\n${HINTS_START}`);
  if (start < 0) return [];
  const suffix = text.slice(start + 2);
  if (!suffix.endsWith(HINTS_END)) return [];

  const lines = suffix.split("\n");
  return HINT_LINES.flatMap(([kind, prefix]) => {
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    if (!line?.endsWith(".")) return [];
    return line
      .slice(prefix.length, -1)
      .split(", ")
      .filter((id) => SAFE_ID.test(id))
      .slice(0, 16)
      .map((id) => ({ kind, id }));
  }).slice(0, 16);
}
