import type { ToolMatcher } from "../types";
import { evmMatchersFor } from "./evm";
import { generalMatcherFor } from "./general";
import { svmMatcherFor } from "./svm";

export const coreMatchersFor = (name: string): ToolMatcher[] | undefined => {
  const general = generalMatcherFor(name);
  if (general) return [general];
  const svm = svmMatcherFor(name);
  return evmMatchersFor(name) ?? (svm ? [svm] : undefined);
};
