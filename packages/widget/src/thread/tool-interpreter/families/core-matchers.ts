import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { evmMatchersFor } from "@/thread/tool-interpreter/families/evm/evm-matchers";
import { generalMatcherFor } from "@/thread/tool-interpreter/families/general/general-matchers";
import { svmMatcherFor } from "@/thread/tool-interpreter/families/svm/svm-matchers";

export const coreMatchersFor = (name: string): ToolMatcher[] | undefined => {
  const general = generalMatcherFor(name);
  if (general) return [general];
  const svm = svmMatcherFor(name);
  return evmMatchersFor(name) ?? (svm ? [svm] : undefined);
};
