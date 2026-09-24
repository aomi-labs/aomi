import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { SUPPORTED_CHAINS } from "./client";
export { SUPPORTED_CHAINS };
import {
  logicalTurnRunning,
  projectRuntimeMessages,
  walletContinuationPending,
} from "@fixture-source/packages/react/src/runtime/utils";
export { walletContinuationPending };
import {
  aaveActivityEvents,
  aaveReviewAction,
  durableActivityEvents,
  durableCommits,
  confirmedCommits,
  commitTraceEvents,
  reportedCommits,
  failedReviewAction,
  recoveryCommits,
} from "./fixtures";

const params = new URLSearchParams(window.location.search);
type FixtureState = "review" | "reported" | "recovery" | "confirmed" | "failed";
const fixtureState = (value: string | null): FixtureState =>
  value === "reported" ||
  value === "recovery" ||
  value === "confirmed" ||
  value === "failed"
    ? value
    : "review";
let state = fixtureState(params.get("state"));
const mode = params.get("mode") ?? "legacy";
const failed = failedReviewAction();
const commitMode = mode === "commit";
let commits =
  state === "recovery"
    ? recoveryCommits
    : state === "reported"
      ? reportedCommits
      : state === "confirmed"
        ? confirmedCommits
        : durableCommits;
const controllerCalls = { execute: [] as string[], reject: [] as string[] };
const commitController = {
  threadId: "thread-1",
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
    ? [...durableActivityEvents, ...commitTraceEvents(state)]
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
  turnState: "complete",
  commits: commitMode ? commits : [],
  commitController: commitMode ? commitController : undefined,
  executeAction: async () => undefined,
  rejectAction: async () => undefined,
  showNotification: () => undefined,
};
runtime.isRunning =
  commitMode &&
  logicalTurnRunning(
    runtime.events,
    projectRuntimeMessages(runtime.events),
    runtime.turnState as Parameters<typeof logicalTurnRunning>[2],
  );

export function setFixtureState(next: FixtureState) {
  state = next;
  commits =
    next === "recovery"
      ? recoveryCommits
      : next === "reported"
        ? reportedCommits
        : next === "confirmed"
          ? confirmedCommits
          : durableCommits;
  runtime.commits = commitMode ? commits : [];
  runtime.events = commitMode
    ? [...durableActivityEvents, ...commitTraceEvents(next)]
    : runtime.events;
  runtime.turnState = "complete";
  runtime.isRunning =
    commitMode &&
    logicalTurnRunning(
      runtime.events,
      projectRuntimeMessages(runtime.events),
      runtime.turnState as Parameters<typeof logicalTurnRunning>[2],
    );
  return next;
}

export function getFixtureRuntime() {
  return runtime;
}

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

export function useControl() {
  return { state: { appDescriptors: [] } };
}

export function useOptionalAomiRuntime() {
  return runtime;
}

export function useThreadTaskRuns() {
  return {};
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
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
}

export function selectTaskRuns() {
  return {};
}
