/**
 * Glyph a renderer draws for a step or chip. The widget maps each to a Lucide
 * icon, the CLI to a character.
 */
export type TraceGlyph =
  | "agent"
  | "allowance"
  | "app"
  | "approve"
  | "archive"
  | "block"
  | "blocked"
  | "bridge"
  | "burn"
  | "code"
  | "coins"
  | "contract"
  | "copies"
  | "dollar"
  | "failed"
  | "gas"
  | "globe"
  | "hash"
  | "history"
  | "incoming"
  | "layers"
  | "list"
  | "network"
  | "outgoing"
  | "page"
  | "pending"
  | "percent"
  | "protocol"
  | "ranked"
  | "read"
  | "receipt"
  | "search"
  | "send"
  | "sign"
  | "simulate"
  | "skill"
  | "solana"
  | "success"
  | "swap"
  | "tag"
  | "tool"
  | "trend"
  | "trim"
  | "user"
  | "verified"
  | "wallet"
  | "warning";

/** A glyph, or a logo key: a chain id, an app brand or a skill id. */
export type TraceIcon =
  | TraceGlyph
  | `chain:${number}`
  | `app:${string}`
  | `skill:${string}`;

export type ToolConfidence = "high" | "medium" | "fallback";

export type ToolChip = {
  key?: string;
  label: string;
  /** App and skill names, rendered with a graphical separator. */
  labelParts?: readonly [string, string];
  /** Stable identity for attribution badges with potentially identical labels. */
  id?: string;
  title?: string;
  skillId?: string;
  attribution?: "app" | "skill";
  icon?: TraceIcon;
  essential?: boolean;
};

export type ToolOutcome =
  | "success"
  | "waiting"
  | "failed"
  | "cancelled"
  | "incomplete"
  | "unknown";

export type InterpretedToolStep = {
  icon: TraceIcon;
  title: string;
  chips: ToolChip[];
  confidence: ToolConfidence;
  rawLabel: string;
  /** The tool reported a failure/error status (drives the red-X step marker). */
  failed: boolean;
  outcome?: ToolOutcome;
};

export type ToolStepInput = {
  toolName: string;
  argsText?: string;
  result?: unknown;
  /** Earlier tool results in the same trace, used to resolve references such
   * as commit `tx_ids` back to the staged transaction's network. */
  relatedResults?: unknown[];
};

export type FactKind =
  | "action"
  | "address"
  | "amount"
  | "block"
  | "category"
  | "chain"
  | "cluster"
  | "code"
  | "compute"
  | "contract"
  | "count"
  | "decoded"
  | "gas"
  | "function"
  | "protocol"
  | "query"
  | "requirement"
  | "route"
  | "selector"
  | "skill"
  | "sourceHost"
  | "threshold"
  | "status"
  | "slot"
  | "token"
  | "txId"
  | "warning"
  | "yield";

export type FactRole =
  | "contract"
  | "decimals"
  | "error"
  | "from"
  | "metadata"
  | "native"
  | "null"
  | "owner"
  | "primary"
  | "recipient"
  | "results"
  | "secondary"
  | "spender"
  | "staged"
  | "to"
  | "tx"
  | "instruction";

export type FactSource = "args" | "decoded" | "result";

export type ToolFact = {
  kind: FactKind;
  role?: FactRole;
  value: string;
  label?: string;
  source: FactSource;
};

export type ToolOperation = {
  id: string;
  facts: ToolFact[];
  confidence: ToolConfidence;
  rawLabel: string;
  /**
   * Title that overrides the descriptor's. Only for families whose title
   * carries payload data (e.g. a delegation's child label), which a static
   * `fixedTitle` cannot express.
   */
  title?: string;
  /**
   * Forces the failed (red X) presentation. Families whose failure signal is
   * not a `failed`/`error` status fact set this explicitly.
   */
  failed?: boolean;
};

export type ToolContext = {
  rawLabel: string;
  parsedArgs: unknown;
  result: unknown;
  resultRecord: Record<string, unknown> | null;
  relatedResultRecords: Record<string, unknown>[];
};

export type ToolMatcher = (ctx: ToolContext) => ToolOperation | null;

/** One prose part of a turn, in transcript order. */
export type TraceTextPart = { type: "text"; text: string };

/** One tool call of a turn, the shape Assistant UI's tool-call part also has. */
export type TraceToolPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
};

export type TracePart = TraceTextPart | TraceToolPart;

/** A delegated agent run, as far as grouping needs it. */
export type TraceRun = { agentId: string; callId: string };
