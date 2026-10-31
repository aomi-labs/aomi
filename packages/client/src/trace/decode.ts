import { interpretToolContext } from "./pipeline";
import { unwrapToolStep } from "./unwrap";
import type { InterpretedToolStep, ToolStepInput } from "./types";

/** One tool call as a trace step: title, chips, status and icon key. */
export const decode = (input: ToolStepInput): InterpretedToolStep =>
  interpretToolContext(unwrapToolStep(input));
