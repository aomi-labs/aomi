import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import type { Descriptor } from "@/thread/tool-interpreter/present/descriptors";

/** Each protocol owns its declared tool names and result interpretation. */
export type ProtocolAdapter = {
  tools: readonly string[];
  match: ToolMatcher;
  descriptors?: Record<string, Descriptor>;
};
