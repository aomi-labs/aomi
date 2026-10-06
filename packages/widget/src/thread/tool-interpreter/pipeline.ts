import { coreToolTitle, declaredToolIdentity } from "./identity";
import { coreMatchersFor } from "@/thread/tool-interpreter/families/core-matchers";
import { matchError } from "@/thread/tool-interpreter/families/general/errors";
import { presentOperation } from "@/thread/tool-interpreter/present/present-operation";
import { protocolMatcherFor } from "@/thread/tool-interpreter/protocols/protocol-matchers";
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
    web_search: "web.search",
    brave_search: "web.search",
    web_fetch: "web.fetch",
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
  const keepsSemanticTitle =
    operation.id.startsWith("evm.call.erc20.") ||
    operation.id === "skill.check";
  return presentOperation({
    ...operation,
    title: keepsSemanticTitle
      ? operation.title
      : (coreTitle ?? operation.title),
  });
};
