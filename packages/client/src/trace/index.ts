// @aomi-labs/client/trace: tool calls and turns as trace steps, without React.
// Renderers map each step's icon key to their own glyph.

export { decode } from "./decode";
export {
  buildTraceItems,
  mergeTracePart,
  traceFromEvents,
  tracePart,
  type TraceItem,
} from "./items";
export {
  CONTEXT_STEP_TOOL,
  contextStepDetail,
  interpretContextStep,
  type ContextStep,
} from "./context";
export { interpretReadOutput, readOutputDetail } from "./read-output";
export { unwrapToolStep } from "./unwrap";
export { messageChainId } from "./families/general/commit-view";
export { STAGED_ACTION_ICON_REGISTRY } from "./registry";
export type {
  InterpretedToolStep,
  ToolChip,
  ToolConfidence,
  ToolOutcome,
  ToolStepInput,
  TraceGlyph,
  TraceIcon,
  TracePart,
  TraceRun,
  TraceTextPart,
  TraceToolPart,
} from "./types";
