import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  aaveActivityEvents,
  aaveReviewAction,
  durableActivityEvents,
  durableCommits,
  failedReviewAction,
  recoveryCommits,
} from "./fixtures";

const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "review";
const mode = params.get("mode") ?? "legacy";
const failed = failedReviewAction();
const commitMode = mode === "commit";
const commits = state === "recovery" ? recoveryCommits : durableCommits;
const controllerCalls = { execute: [] as string[], reject: [] as string[] };
const commitController = {
  review(id: string) {
    return commits.find((commit) => commit.commit_id === id)?.review?.request;
  },
  canExecute(view: (typeof commits)[number]) {
    return view.action != null;
  },
  async execute(id: string) {
    controllerCalls.execute.push(id);
  },
  async reject(id: string) {
    controllerCalls.reject.push(id);
  },
};

const runtime = {
  threadViewKey: "fixture-aave-review",
  events: commitMode
    ? durableActivityEvents
    : state === "failed"
      ? [...aaveActivityEvents.slice(0, -1), failed]
      : aaveActivityEvents,
  pendingActions: commitMode
    ? []
    : state === "failed"
      ? [failed]
      : [aaveReviewAction],
  actionAttempts: new Map(),
  isRunning: false,
  commits: commitMode ? commits : [],
  commitController: commitMode ? commitController : undefined,
  executeAction: async () => undefined,
  rejectAction: async () => undefined,
  showNotification: () => undefined,
};

Object.assign(window, {
  __transactionReviewFixture: {
    mode,
    pendingActions: runtime.pendingActions.length,
    commitIds: runtime.commits.map((commit) => commit.commit_id),
    sourceIds: runtime.commits.flatMap(
      (commit) => commit.batch?.sources.map((source) => source.source_id) ?? [],
    ),
    controllerCalls,
  },
});

export function useAomiRuntime() {
  return runtime;
}

export function useAomiWalletKit() {
  return {
    supportedChains: [
      {
        id: 8453,
        name: "Base",
        nativeCurrency: { symbol: "ETH" },
      },
    ],
    identity: {
      address:
        aaveReviewAction.request.type === "execute_evm"
          ? aaveReviewAction.request.transactions[0]?.from
          : undefined,
      chainId: 8453,
    },
  };
}

export function useCommitCapabilities() {
  return {};
}

export function useSkillCatalog() {
  return {
    skills: [
      { id: "aave", name: "Aave" },
      { id: "common_erc20", name: "Common Erc20" },
    ],
    loading: false,
    error: null,
  };
}

export function skillLabel(skill: { name: string }) {
  return skill.name;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getChainInfo(chainId: number) {
  return chainId === 8453
    ? { id: 8453, name: "Base", ticker: "ETH" }
    : undefined;
}

export const SUPPORTED_CHAINS = [{ id: 8453, name: "Base", ticker: "ETH" }];

export function selectTaskRuns() {
  return {};
}

export function normalizeSolanaCluster(cluster?: string) {
  return cluster;
}

export function summarizeSimulation(simulation: Record<string, unknown>) {
  const passed =
    simulation.status === "passed" || simulation.batch_success === true;
  return { passed };
}

export function isTerminalCommit(commit: { state?: string }) {
  return ["confirmed", "failed", "rejected", "expired"].includes(
    commit.state ?? "",
  );
}
