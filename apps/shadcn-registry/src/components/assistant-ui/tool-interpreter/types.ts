import type { LucideIcon } from "lucide-react";
import type { ElementType } from "react";

export type ToolConfidence = "high" | "medium" | "fallback";

export type ToolChip = {
  label: string;
  dot?: string;
  icon?: ElementType;
};

export type InterpretedToolStep = {
  icon: LucideIcon;
  title: string;
  chips: ToolChip[];
  confidence: ToolConfidence;
  rawLabel: string;
  /** The tool reported a failure/error status (drives the red-X step marker). */
  failed: boolean;
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
  | "chain"
  | "cluster"
  | "code"
  | "count"
  | "decoded"
  | "gas"
  | "selector"
  | "skill"
  | "sourceHost"
  | "status"
  | "slot"
  | "token"
  | "txId";

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
  | "tx";

export type FactSource = "args" | "decoded" | "label" | "result";

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
