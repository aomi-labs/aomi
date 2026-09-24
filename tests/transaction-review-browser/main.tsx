import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import "@fixture-source/apps/shadcn-registry/src/package.css";
import { ActivitySidebar } from "@fixture-source/apps/shadcn-registry/src/components/activity-sidebar/activity-sidebar";
import { AssistantTurnParts } from "@fixture-source/apps/shadcn-registry/src/components/assistant-ui/working-trace";
import { ToolStepRow } from "@fixture-source/apps/shadcn-registry/src/components/assistant-ui/working-trace-rows";
import {
  interpretToolStep,
  type ToolStepInput,
} from "@fixture-source/apps/shadcn-registry/src/components/assistant-ui/tool-interpreter";
import {
  logicalTurnRunning,
  projectRuntimeMessages,
} from "@fixture-source/packages/react/src/runtime/utils";
import { getFixtureRuntime, setFixtureState } from "./runtime";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.className = theme;
const attributionMode = params.get("mode") === "attribution-trace";

function Fixture() {
  const [state, setState] = useState(
    ["reported", "recovery", "confirmed"].includes(params.get("state") ?? "")
      ? params.get("state")!
      : "review",
  );
  const transition = (
    next: "review" | "reported" | "recovery" | "confirmed",
  ) => {
    setFixtureState(next);
    setState(next);
  };
  return (
    <main
      data-testid="transaction-review-fixture"
      data-mode={params.get("mode") ?? "review"}
      className={`bg-aomi-bg text-aomi-fg grid h-[825px] w-full max-w-[1355px] overflow-hidden ${attributionMode ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_376px]"}`}
    >
      <section
        id="fixture-chat"
        className="relative px-16 py-12"
        aria-label="Fixture chat context"
      >
        <p className="bg-aomi-surface ml-auto w-fit rounded-2xl px-5 py-3 text-[15px]">
          Deposit 100 USDC to Aave
        </p>
        <article className="border-aomi-border mt-12 rounded-2xl border p-6 text-[14px]">
          {attributionMode ? (
            <AttributionTraceFixture />
          ) : params.get("mode") === "arc-trace" ? (
            <ArcTraceFixture />
          ) : params.get("mode") === "commit" ? (
            <TraceFixture state={state} />
          ) : (
            <p className="text-aomi-muted mb-5 text-[13px]">
              Working · 17 steps
            </p>
          )}
          {params.get("mode") === "commit" && (
            <div
              className="my-4 flex gap-2"
              aria-label="Fixture state controls"
            >
              <button type="button" onClick={() => transition("reported")}>
                Show submitted
              </button>
              <button type="button" onClick={() => transition("recovery")}>
                Show mismatch
              </button>
              <button type="button" onClick={() => transition("confirmed")}>
                Show confirmed
              </button>
            </div>
          )}
          <h2 className="font-medium">Simulate transaction</h2>
          <div className="text-aomi-muted mt-3 flex flex-wrap gap-2 text-[12px]">
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Base
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              2 txs
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              226,611 gas
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Success
            </span>
          </div>
          <p className="text-aomi-muted mt-5 max-w-[760px] leading-6">
            Your Base wallet has 304.077784 USDC. I verified the exact batch:
            approve 100 USDC to Aave, then supply 100 USDC. Simulation passed;
            the supply moves 100 USDC from your wallet into Aave and mints the
            corresponding aUSDC position.
          </p>
          <h2 className="mt-6 font-medium">Commit transactions</h2>
          <div className="text-aomi-muted mt-3 flex gap-2 text-[12px]">
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Base
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              2 txs
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              {state === "confirmed"
                ? "Confirmed on-chain"
                : state === "recovery"
                  ? "Wallet transaction needs attention"
                  : state === "reported"
                    ? "Checking on-chain"
                    : "Pending approval"}
            </span>
          </div>
        </article>
      </section>
      {!attributionMode && (
        <section
          id="sidebar-fixture-mount"
          className="relative h-[825px]"
          aria-label="Sidebar fixture mount"
        >
          <ActivitySidebar />
        </section>
      )}
    </main>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root data-testid="assistant-row">
      <AssistantTurnParts />
      <ActionBarPrimitive.Root hideWhenRunning>
        <ActionBarPrimitive.Copy aria-label="Copy" />
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function TraceFixture({ state }: { state: string }) {
  const snapshot = getFixtureRuntime();
  const messages = projectRuntimeMessages(snapshot.events);
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: logicalTurnRunning(
      snapshot.events,
      messages,
      snapshot.turnState,
    ),
    onNew: async () => undefined,
    convertMessage: (message) => message,
  });
  return (
    <div data-testid="trace-state" data-state={state}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages
            components={{ UserMessage: () => null, AssistantMessage }}
          />
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </div>
  );
}

const arcTraceSteps: ToolStepInput[] = [
  {
    toolName: "get_time_and_onchain_context",
    result: { chain_id: 5042, chain_name: "arc", block_number: 22383269 },
  },
  {
    toolName: "get_account_info",
    argsText: JSON.stringify({ chain_id: 5042 }),
    result: {
      address: "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0",
      balance_native: "126.8818059542916",
      native_currency: "USDC",
      nonce: 24,
    },
  },
  {
    toolName: "aave_v4_markets",
    result: { protocol: "aave_v4", chain_id: 5042, markets: [] },
  },
  {
    toolName: "aave_v4_prepare",
    result: {
      protocol: "aave_v4",
      chain_id: 5042,
      operation: "supply",
      amount: { display: "10 USDC" },
      approval: { required: true },
      status: "prepared",
    },
  },
];

function ArcTraceFixture() {
  return (
    <div data-testid="arc-trace-fixture" className="aui-working-trace">
      {arcTraceSteps.map((step) => (
        <ToolStepRow
          key={step.toolName}
          interpretation={interpretToolStep(step)}
          done
          active={false}
          animate={false}
        />
      ))}
    </div>
  );
}

const attributionCatalog: NonNullable<ToolStepInput["attribution"]> = {
  apps: [
    { name: "hoodit", metadata: { tool_names: ["hoodit_search_tokens"] } },
  ],
  skills: [
    {
      id: "hoodit/markets",
      name: "Markets",
      injectedTools: ["hoodit_search_tokens"],
    },
    { id: "lifi_swap", name: "LI.FI Swap", injectedTools: ["lifi_get_quote"] },
  ],
};

const attributionTraceSteps: ToolStepInput[] = [
  {
    toolName: "activate_skills",
    result: { activated: ["hoodit/markets", "lifi_swap"] },
  },
  { toolName: "hoodit_search_tokens" },
  {
    toolName: "lifi_get_quote",
    result: {
      quote_id: "quote-1",
      chain_id: 8453,
      from_token: { symbol: "USDC" },
      to_token: { symbol: "ETH" },
      from_amount: { display: "10 USDC" },
      estimate: { to_amount_display: "0.002 ETH" },
    },
  },
  {
    toolName: "evm_commit_txs",
    argsText: JSON.stringify({ tx_ids: [1] }),
    result: { status: "pending_approval", chain_id: 5042 },
  },
];

function AttributionTraceFixture() {
  return (
    <div data-testid="attribution-trace-fixture" className="aui-working-trace">
      {attributionTraceSteps.map((step) => (
        <ToolStepRow
          key={step.toolName}
          interpretation={interpretToolStep({
            ...step,
            attribution: attributionCatalog,
          })}
          done={step.result !== undefined}
          active={step.result === undefined}
          animate={false}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
