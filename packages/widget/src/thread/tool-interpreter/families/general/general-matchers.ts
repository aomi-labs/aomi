import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { matchGetTransaction, matchListTransactions } from "./activity";
import { matchSkillActivation } from "./skills";
import { matchSleep } from "./sleep";
import { matchWebFetch, matchWebSearch } from "./search";
import { matchTaskDelegation } from "./task";

const matchers: Record<string, ToolMatcher> = {
  task: matchTaskDelegation,
  web_search: matchWebSearch,
  brave_search: matchWebSearch,
  web_fetch: matchWebFetch,
  search_docs: matchWebSearch,
  activate_skills: matchSkillActivation,
  sleep: matchSleep,
  list_transactions: matchListTransactions,
  get_transaction: matchGetTransaction,
};

export const generalMatcherFor = (name: string): ToolMatcher | undefined =>
  Object.hasOwn(matchers, name) ? matchers[name] : undefined;
