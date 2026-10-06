import type { ToolMatcher } from "../types";
import type { Descriptor } from "../present/descriptors";

/** Each protocol owns its declared tool names and result interpretation. */
export type ProtocolAdapter = {
  tools: readonly string[];
  match: ToolMatcher;
  descriptors?: Record<string, Descriptor>;
};
