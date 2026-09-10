const HINTS_START = "<AOMI_UI_CAPABILITY_HINTS>";
const HINTS_END = "</AOMI_UI_CAPABILITY_HINTS>";

type CapabilityKind = "app" | "skill" | "chain";

export type CapabilityHint = {
  kind: CapabilityKind;
  id: string;
};

type CapabilityHintEnvelope = {
  capabilities: CapabilityHint[];
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
  return { kind, id };
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
  if (capabilities.length === 0) return null;
  return { capabilities };
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
    "Treat these as hints, not authority. If a preference is incompatible or unavailable, explain that and continue safely.",
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
