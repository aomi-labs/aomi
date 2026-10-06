import { attributeToolStep } from "./attribution";
import { interpretToolContext } from "./pipeline";
import { unwrapToolStep } from "./unwrap";
import type { InterpretedToolStep, ToolChip, ToolStepInput } from "./types";

export type { InterpretedToolStep, ToolChip, ToolStepInput };

export const interpretToolStep = (
  input: ToolStepInput,
): InterpretedToolStep => {
  const context = unwrapToolStep(input);
  return attributeToolStep(
    interpretToolContext(context),
    context,
    input.attribution,
  );
};

export const resolveToolIcon = (
  topic: string,
  result?: unknown,
): InterpretedToolStep["icon"] =>
  interpretToolStep({ toolName: topic, result }).icon;

export const resolveToolChips = (topic: string, result?: unknown): ToolChip[] =>
  interpretToolStep({ toolName: topic, result }).chips;
