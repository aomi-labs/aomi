import type { ToolMatcher } from "../../types";
import { matchSkillActivation } from "./skills";
import { matchWebSearch } from "./search";
import { matchTaskDelegation } from "./task";

const matchers: Record<string, ToolMatcher> = {
  task: matchTaskDelegation,
  brave_search: matchWebSearch,
  search_docs: matchWebSearch,
  activate_skills: matchSkillActivation,
};

export const generalMatcherFor = (name: string): ToolMatcher | undefined =>
  Object.hasOwn(matchers, name) ? matchers[name] : undefined;
