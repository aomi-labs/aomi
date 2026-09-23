import { coreToolTitle, declaredToolIdentity } from "./identity";
import { coreMatchersFor } from "./families";
import { matchError } from "./families/general/errors";
import { presentOperation } from "./present";
import { protocolMatcherFor } from "./protocols";
import type {
  InterpretedToolStep,
  ToolConfidence,
  ToolContext,
  ToolMatcher,
} from "./types";

/** Identity selects an adapter; payload shape only determines facts inside it. */
const matchersFor = (name: string): ToolMatcher[] => {
  const protocol = protocolMatcherFor(name);
  return [
    ...(coreMatchersFor(name) ?? (protocol ? [protocol] : [])),
    matchError,
  ];
};

const fallbackOperation = (ctx: ToolContext) => {
  const name = declaredToolIdentity(ctx.rawLabel);
  const coreIds: Record<string, string> = {
    brave_search: "web.search",
    activate_skills: "skill.activate",
    get_contract: "evm.contract.lookup.found",
    encode_and_call: "evm.call.generic",
    sim_call: "evm.call.generic",
  };
  const coreId = Object.hasOwn(coreIds, name) ? coreIds[name] : undefined;
  const confidence: ToolConfidence = coreId ? "high" : "fallback";

  return {
    id: coreId ?? "fallback",
    facts: [],
    confidence,
    rawLabel: ctx.rawLabel,
    title: coreToolTitle(ctx.rawLabel),
  };
};

export const interpretToolContext = (ctx: ToolContext): InterpretedToolStep => {
  const name = declaredToolIdentity(ctx.rawLabel);
  const operation =
    matchersFor(name).reduce<ReturnType<ToolMatcher>>(
      (matched, matcher) => matched ?? matcher(ctx),
      null,
    ) ?? fallbackOperation(ctx);

  const coreTitle = coreToolTitle(ctx.rawLabel);
  const keepsSemanticTitle = operation.id.startsWith("evm.call.erc20.");
  return presentOperation({
    ...operation,
    title: keepsSemanticTitle
      ? operation.title
      : (coreTitle ?? operation.title),
  });
};
