// "@" mentions: what the composer's picker offers, how it ranks, and the
// model hint a send carries. The widget and the CLI share all of it.

const HINTS_START = "<AOMI_UI_CAPABILITY_HINTS>";
const HINTS_END = "</AOMI_UI_CAPABILITY_HINTS>";

export type CapabilityKind = "app" | "skill" | "chain" | "wallet";

export type CapabilityHint = {
  kind: CapabilityKind;
  id: string;
  label?: string;
  appName?: string;
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
    (kind !== "app" &&
      kind !== "skill" &&
      kind !== "chain" &&
      kind !== "wallet") ||
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
  const appName =
    kind === "app" &&
    typeof candidate.appName === "string" &&
    SAFE_ID.test(candidate.appName)
      ? candidate.appName
      : undefined;
  return {
    kind,
    id,
    ...(label ? { label } : {}),
    ...(appName ? { appName } : {}),
  };
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
  for (const hint of envelope.capabilities.filter(
    (hint) => hint.kind === "app",
  )) {
    const id = hint.id;
    const applicationId = /^application:[1-9][0-9]*$/u.test(id)
      ? Number(id.slice("application:".length))
      : NaN;
    const target =
      Number.isSafeInteger(applicationId) && applicationId > 0
        ? {
            ...(hint.appName ? { app: hint.appName } : {}),
            application_id: applicationId,
          }
        : id.startsWith("name:") && SAFE_ID.test(id.slice(5))
          ? { app: id.slice(5) }
          : null;
    if (!target) continue;
    lines.push(`Selected app task target: ${JSON.stringify(target)}`);
  }
  if (lines.some((line) => line.startsWith("Selected app task target:"))) {
    lines.push(
      "For work addressed to a selected app, including requests to list its tools, call `task` with a work order in `tasks` using that target and the user's request as `prompt`.",
      "Copy the selected app task target exactly. Display labels must not be used as task app names; when the target contains only application_id, omit app.",
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
  const wallets = envelope.capabilities.filter(
    (hint) => hint.kind === "wallet",
  );
  if (wallets.length > 0) {
    lines.push(`Preferred wallet ids: ${wallets.map((w) => w.id).join(", ")}.`);
    for (const wallet of wallets) {
      lines.push(
        `User tagged wallet ${wallet.id}${wallet.label ? ` (${JSON.stringify(wallet.label)})` : ""}.`,
      );
    }
    lines.push(
      "Act for a tagged wallet by passing its id as wallet_id on that call; the ids are in [[WALLETS]]. A wallet tagged with two ids (same name) is one wallet with an address per chain family: pass the id whose family matches the call. Tagging a wallet never signs: its own signing rules still apply.",
    );
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
  ["wallet", "Preferred wallet ids: "],
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

/** A picker row: a capability a person can tag with "@". */
export type MentionItem = {
  kind: CapabilityKind;
  id: string;
  label: string;
  description?: string;
  searchText: string;
  /** An app: its registered name, kept for the task target. */
  appName?: string;
  /** A wallet: the `w_N` id of each of its addresses (EVM, SVM). */
  walletIds?: readonly string[];
  /** Test and local networks stay out of the picker until searched for. */
  testnet?: boolean;
  disabled?: boolean;
};

export type MentionGroup<T extends MentionItem = MentionItem> = {
  kind: CapabilityKind;
  label: string;
  items: T[];
};

const BARE_MENTION_LIMIT = 4;
const TESTNET_QUERY =
  /test|sepolia|devnet|holesky|goerli|amoy|fuji|local|anvil/;
const MENTION_GROUPS = [
  { kind: "app", label: "Apps" },
  { kind: "skill", label: "Skills" },
  { kind: "chain", label: "Chains" },
  { kind: "wallet", label: "Wallets" },
] as const;

/**
 * The picker's sections for an "@" query. A bare "@" previews a few of each
 * section so Chains isn't buried; typing searches everything. Test networks
 * appear only when searched for. A wallet matching the query comes first (a
 * typed name most likely means a wallet), else a chain named by the query.
 */
export function mentionGroups<T extends MentionItem>(
  items: readonly T[],
  query: string,
): MentionGroup<T>[] {
  const needle = query.trim().toLowerCase();
  const wantsTestnets = TESTNET_QUERY.test(needle);
  const matching = items.filter(
    (item) =>
      (!item.testnet || wantsTestnets) &&
      (!needle ||
        `${item.label} ${item.searchText}`.toLowerCase().includes(needle)),
  );
  const named = (item: T) =>
    Boolean(needle) && item.label.toLowerCase().startsWith(needle);
  const groups = MENTION_GROUPS.map((group) => {
    const groupItems = matching
      .filter((item) => item.kind === group.kind)
      .sort((a, b) => Number(named(b)) - Number(named(a)));
    return {
      ...group,
      items: needle ? groupItems : groupItems.slice(0, BARE_MENTION_LIMIT),
    };
  });
  const [apps, skills, chains, wallets] = groups as [
    MentionGroup<T>,
    MentionGroup<T>,
    MentionGroup<T>,
    MentionGroup<T>,
  ];
  const others = chains.items.some(named)
    ? [chains, apps, skills]
    : [apps, skills, chains];
  const ordered = needle ? [wallets, ...others] : [...others, wallets];
  return ordered.filter((group) => group.items.length > 0);
}

const TESTNET_NAME =
  /sepolia|testnet|devnet|holesky|goerli|amoy|fuji|anvil|localhost/i;

/** Test and local EVM networks, which the picker hides until searched for. */
export function isTestnetChain(chain: {
  id: number;
  name: string;
  testnet?: boolean;
}): boolean {
  return (
    Boolean(chain.testnet) ||
    chain.id === 31337 ||
    TESTNET_NAME.test(chain.name)
  );
}

/** A tagged capability as the send carries it. */
export type CapabilitySelection = {
  kind: CapabilityKind;
  id: string;
  label?: string;
  appName?: string;
  /** A wallet: the `w_N` id of each address, one hint apiece. */
  walletIds?: readonly string[];
};

/** What a send's mentions become: the envelope `appendCapabilityHints` reads. */
export function capabilityHintPayload(
  selections: readonly CapabilitySelection[],
  removedApps: readonly CapabilitySelection[] = [],
):
  | { capabilities: CapabilityHint[]; removedApps?: CapabilityHint[] }
  | undefined {
  if (selections.length === 0 && removedApps.length === 0) return undefined;
  return {
    ...(removedApps.length
      ? {
          removedApps: removedApps.map(({ id, label }) => ({
            kind: "app" as const,
            id,
            ...(label ? { label } : {}),
          })),
        }
      : {}),
    capabilities: selections.flatMap(
      ({ kind, id, label, appName, walletIds }) =>
        (kind === "wallet" && walletIds?.length ? walletIds : [id]).map(
          (hintId) => ({
            kind,
            id: hintId,
            ...((kind === "app" || kind === "wallet") && label
              ? { label }
              : {}),
            ...(kind === "app" && appName ? { appName } : {}),
          }),
        ),
    ),
  };
}

// Skills, as the public catalog lists them.

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  featureCatalog: string[];
  chainIds: number[];
  injectedTools: string[];
  estimatedTokens?: number;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    : [];
}

function parseSkill(value: unknown): SkillSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    tags: strings(row.tags),
    featureCatalog: strings(row.feature_catalog),
    chainIds: numbers(row.chain_ids),
    injectedTools: strings(row.injected_tools),
    ...(typeof row.est_tokens === "number"
      ? { estimatedTokens: row.est_tokens }
      : {}),
  };
}

export function parseSkillCatalog(value: unknown): SkillSummary[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as Record<string, unknown>).skills;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseSkill)
    .filter((skill): skill is SkillSummary => skill !== null);
}

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

const CHAIN_CONTEXT =
  /\s+(?:on|from|across)\s+(?:Ethereum|Arbitrum(?: One)?|Optimism|OP Mainnet|Polygon|Base|Linea|Monad|MegaETH|Robinhood|Solana)\b.*$/iu;

/** Turn registry prose into a quiet one-line capability summary for pickers. */
export function conciseSkillDescription(description: string): string {
  const original = description.trim();
  if (!original) return "";

  let summary = original
    .split(/\n|(?<=[.!?])\s/u, 1)[0]!
    .replace(
      /^use (?:this skill )?when (?:the )?users? (?:want|wants|need|needs) (?:to\s+)?/iu,
      "",
    )
    .replace(/\s+[—;].*$/u, "")
    .replace(/\s+via\s+.*$/iu, "")
    .replace(CHAIN_CONTEXT, "")
    .replace(/\bERC20\b/giu, "ERC-20")
    .replace(/[.!?]+$/u, "")
    .trim();

  if (!summary) summary = original;
  summary = `${summary[0]?.toUpperCase() ?? ""}${summary.slice(1)}`;
  if (summary.length <= 64) return summary;

  const boundary = summary.lastIndexOf(" ", 61);
  return `${summary.slice(0, boundary >= 42 ? boundary : 61).trimEnd()}…`;
}
