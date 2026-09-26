import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommitView, Event } from "@aomi-labs/client";
import { action, runtime, simulation } from "./test-fixtures";
import { ActivitySidebar } from "./activity-sidebar";
import { TraceAttributionContext } from "../assistant-ui/trace-attribution";
import { ToolStepRow } from "../assistant-ui/working-trace-rows";
import { interpretToolStep } from "../assistant-ui/tool-interpreter";

describe("activity signing strip", () => {
  it("keeps Signed neutral until signing and puts rejection in the strip", () => {
    const current = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x123",
          to: "0x456",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
      simulation: simulation(),
    });
    runtime.pendingActions = [current];
    runtime.events = [current];
    const { rerender } = render(<ActivitySidebar />);
    expect(screen.getByTitle("Not yet signed").firstElementChild).toHaveClass(
      "bg-aomi-border",
    );
    runtime.pendingActions = [];
    runtime.events = [
      {
        ...current,
        state: "rejected",
        revision: 2,
        result: { status: "rejected", reason: "Request rejected" },
      },
    ];
    rerender(<ActivitySidebar />);
    expect(screen.getByTitle("Signing rejected").firstElementChild).toHaveClass(
      "bg-aomi-danger",
    );
    expect(screen.getByTestId("activity-transaction")).not.toHaveTextContent(
      "rejected",
    );
    expect(screen.queryByTestId("transaction-review")).not.toBeInTheDocument();
  });
  it("colors Signed blue when the wallet returns a submitted leg", () => {
    const current = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x123",
          to: "0x456",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
      simulation: simulation(),
    });
    runtime.pendingActions = [];
    runtime.events = [
      {
        ...current,
        state: "completed",
        result: {
          status: "submitted",
          legs: [{ id: "leg_1", status: "submitted", transactionId: "0xhash" }],
        },
      },
    ];
    render(<ActivitySidebar />);
    expect(screen.getByTitle("Signed").firstElementChild).toHaveClass(
      "bg-aomi-accent",
    );
    expect(screen.getByTestId("activity-transaction")).not.toHaveTextContent(
      "submitted",
    );
  });
});

describe("active transaction presentation", () => {
  it("animates unfinished callback preparation and a later wallet request beside a completed transaction", () => {
    const self = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x123",
          to: "0x456",
          data: "0x",
          label: "Completed transfer",
          kind: "transfer",
        },
      ],
      simulation: simulation(),
    });
    const callback = "broadcast-terminal:prepared-pair";
    const event = (sequence: number, turn: string, payload: object) =>
      ({
        event_id: `progress-${sequence}`,
        sequence,
        turn_id: turn,
        occurred_at: sequence,
        ...payload,
      }) as Event;
    const tool = (
      sequence: number,
      turn: string,
      name: string,
      result: object,
    ) =>
      event(sequence, turn, {
        type: "message",
        sender: "agent",
        content: "",
        tool_name: name,
        tool_result: [name, JSON.stringify(result)],
      });
    const events: Event[] = [
      event(1, "turn-1", {
        type: "message",
        sender: "user",
        content: "Transfer then prepare the pair",
      }),
      {
        ...self,
        sequence: 2,
        state: "completed",
        result: {
          status: "submitted",
          legs: [{ id: "leg_1", status: "submitted", transactionId: "0xhash" }],
        },
      },
      tool(3, "turn-1", "evm_commit_txs", {
        commits: [
          {
            commit_id: "completed-commit",
            batch: { batch_id: "prepared-pair" },
          },
        ],
      }),
      event(4, "turn-1", { type: "turn_state_changed", state: "complete" }),
      event(5, callback, { type: "turn_state_changed", state: "processing" }),
      tool(6, callback, "evm_stage_tx", {
        pending_tx_id: 2,
        current_lifecycle: "queued",
        chain_id: 8453,
        label: "Approve USDC",
        kind: "approval",
      }),
      tool(7, callback, "evm_stage_tx", {
        pending_tx_id: 3,
        current_lifecycle: "queued",
        chain_id: 8453,
        label: "Supply USDC",
        kind: "supply",
      }),
    ];
    runtime.events = events;
    runtime.isRunning = true;
    const { rerender } = render(<ActivitySidebar />);
    const card = (label: string) =>
      screen.getByTitle(label).closest('[data-testid="activity-transaction"]')!;
    expect(
      card("Completed transfer").querySelector("[data-active-phase]"),
    ).toBeNull();
    expect(
      card("Approve USDC").querySelector('[title="Stage"] [data-active-phase]'),
    ).not.toBeNull();
    expect(
      card("Supply USDC").querySelector('[title="Stage"] [data-active-phase]'),
    ).not.toBeNull();
    runtime.events = [
      ...events,
      tool(8, callback, "simulate_batch", {
        resolved_ids: [2, 3],
        simulation: { batch_success: true },
      }),
    ];
    rerender(<ActivitySidebar />);
    expect(
      card("Approve USDC").querySelector(
        '[title="Simulate"] [data-active-phase]',
      ),
    ).not.toBeNull();
    expect(
      card("Supply USDC").querySelector(
        '[title="Simulate"] [data-active-phase]',
      ),
    ).not.toBeNull();
    runtime.isRunning = false;
    runtime.events = [
      ...runtime.events,
      event(9, callback, { type: "turn_state_changed", state: "complete" }),
    ];
    rerender(<ActivitySidebar />);
    expect(
      card("Approve USDC").querySelector("[data-active-phase]"),
    ).not.toBeNull();
    expect(
      card("Supply USDC").querySelector("[data-active-phase]"),
    ).not.toBeNull();

    // A later explicit confirmation admits the same staged sources. Their
    // origin remains the callback, but the new durable wallet request is live.
    runtime.events = [
      ...runtime.events,
      event(10, "confirm-turn", {
        type: "message",
        sender: "user",
        content: "Commit that prepared pair",
      }),
      event(11, "confirm-turn", {
        type: "turn_state_changed",
        state: "processing",
      }),
    ];
    runtime.commits = [2, 3].map((id, index) => ({
      commit_id: `new-commit-${id}`,
      thread_id: "thread-1",
      stage_id: `evm:${id}`,
      chain_family: "evm",
      chain_ref: "8453",
      state: "needs_signature",
      version: 1,
      created_at: 1,
      updated_at: 1,
      metadata: {},
      action: null,
      review: null,
      wallet_attempt: null,
      batch: {
        batch_id: "new-pair",
        index,
        ordered_commit_ids: ["new-commit-2", "new-commit-3"],
        ordered_stage_ids: ["evm:2", "evm:3"],
        sources: [
          {
            thread_id: "thread-1",
            chain_family: "evm",
            chain_ref: "8453",
            stage_id: `evm:${id}`,
            source_id: id,
          },
        ],
        review_digest: "review",
        predecessor_commit_id: index ? "new-commit-2" : null,
      },
    })) as unknown as CommitView[];
    runtime.isRunning = true;
    rerender(<ActivitySidebar />);
    expect(
      card("Approve USDC").querySelector(
        '[title="Commit"] [data-active-phase]',
      ),
    ).not.toBeNull();
    expect(
      card("Supply USDC").querySelector('[title="Commit"] [data-active-phase]'),
    ).not.toBeNull();
    runtime.commitController = {
      submissionPhase: () => "awaiting_wallet",
    } as unknown as typeof runtime.commitController;
    rerender(<ActivitySidebar />);
    expect(
      card("Approve USDC").querySelector(
        '[title="Not yet signed"] [data-active-phase]',
      ),
    ).not.toBeNull();
    expect(
      card("Completed transfer").querySelector("[data-active-phase]"),
    ).toBeNull();
    runtime.commitController = undefined;
    runtime.commits = runtime.commits.map((commit) => ({
      ...commit,
      state: "confirmed",
    }));
    runtime.isRunning = false;
    rerender(<ActivitySidebar />);
    expect(
      card("Approve USDC").querySelector("[data-active-phase]"),
    ).toBeNull();
    expect(card("Supply USDC").querySelector("[data-active-phase]")).toBeNull();
  });

  it("moves animation to signing, then stops for completed work", () => {
    const current = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x123",
          to: "0x456",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
      simulation: simulation(),
    });
    runtime.events = [current];
    runtime.pendingActions = [current];
    const { rerender } = render(<ActivitySidebar />);
    expect(screen.getByTitle("Commit").firstElementChild).toHaveAttribute(
      "data-active-phase",
      "true",
    );
    expect(
      screen
        .getByTestId("activity-transaction")
        .querySelector("details, summary, pre"),
    ).toBeNull();
    runtime.actionAttempts.set(current.id, { state: "executing" });
    rerender(<ActivitySidebar />);
    expect(
      screen.getByTitle("Not yet signed").firstElementChild,
    ).toHaveAttribute("data-active-phase", "true");
    runtime.actionAttempts.clear();
    runtime.pendingActions = [];
    runtime.events = [
      {
        ...current,
        state: "completed",
        result: {
          status: "submitted",
          legs: [{ id: "leg_1", status: "submitted", transactionId: "0xhash" }],
        },
      },
    ];
    rerender(<ActivitySidebar />);
    expect(
      screen
        .getByTestId("activity-transaction")
        .querySelector("[data-active-phase]"),
    ).toBeNull();
  });
  it("keeps an unfinished request animated when a newer turn begins", () => {
    const current = action({
      type: "execute_evm",
      transactions: [
        {
          chain_id: 8453,
          from: "0x123",
          to: "0x456",
          data: "0x",
          label: "Transfer",
          kind: "transfer",
        },
      ],
      simulation: simulation(),
    });
    runtime.pendingActions = [current];
    runtime.isRunning = true;
    runtime.events = [
      current,
      {
        type: "message",
        event_id: "new",
        sequence: 2,
        turn_id: "new-turn",
        occurred_at: 2,
        sender: "user",
        content: "New request",
      },
    ];
    render(<ActivitySidebar />);
    expect(
      screen
        .getByTestId("activity-transaction")
        .querySelector("[data-active-phase]"),
    ).not.toBeNull();
  });
  it("uses Library skill display labels", () => {
    runtime.pendingActions = [];
    runtime.events = [
      {
        type: "message",
        event_id: "skill",
        sequence: 1,
        turn_id: "turn-1",
        occurred_at: 1,
        sender: "agent",
        content: "",
        tool_result: [
          "activate_skill",
          JSON.stringify({ activated: ["aave"] }),
        ],
      },
    ];
    const { container } = render(<ActivitySidebar />);
    expect(screen.getByText("Aave")).toBeInTheDocument();
    expect(screen.queryByText("aave")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Skills 1" });
    const content = container.querySelector(
      '[data-activity-group-content="Skills"]',
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveClass("grid-rows-[1fr]", "opacity-100");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveClass("grid-rows-[0fr]", "opacity-0");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Aave")).toBeInTheDocument();
  });

  it("matches the trace's app/skill label, icon and slash in the activity sidebar", () => {
    const result = { activated: ["hoodit/portfolio", "lifi_swap"] };
    runtime.events = [
      {
        type: "message",
        event_id: "skills",
        sequence: 1,
        turn_id: "turn-1",
        occurred_at: 1,
        sender: "agent",
        content: "",
        tool_result: ["activate_skills", JSON.stringify(result)],
      },
    ];
    const attribution = {
      apps: [
        {
          name: "hoodit",
          applicationId: 2937810,
          metadata: { registered_via: "activate_apps" },
        },
      ],
      skills: [
        {
          id: "hoodit/portfolio",
          name: "Portfolio",
          injectedTools: ["hoodit_get_portfolio"],
        },
      ],
    };
    const { container } = render(
      <TraceAttributionContext.Provider value={attribution}>
        <ActivitySidebar />
        <ToolStepRow
          interpretation={interpretToolStep({
            toolName: "activate_skills",
            result,
            attribution,
          })}
          done
          active={false}
          animate={false}
        />
      </TraceAttributionContext.Provider>,
    );
    for (const title of [
      "App: Hoodit / Skill: Portfolio",
      "Skill: Lifi Swap",
    ]) {
      const badges = screen.getAllByTitle(title);
      expect(badges).toHaveLength(2);
      expect(badges[0].outerHTML).toBe(badges[1].outerHTML);
    }
    const sidebarBadge = container.querySelector(
      '[data-activity-group-content="Skills"] [title="App: Hoodit / Skill: Portfolio"]',
    );
    expect(sidebarBadge).toHaveTextContent("Hoodit / Portfolio");
    expect(
      sidebarBadge?.querySelector('svg[viewBox="0 0 8 16"]'),
    ).not.toBeNull();
  });

  it("uses icon states and only renders the formatted subagent result", () => {
    runtime.pendingActions = [];
    runtime.events = [
      {
        type: "task_started",
        event_id: "task-started",
        sequence: 1,
        turn_id: "turn-1",
        occurred_at: 1,
        call_id: "call-1",
        agent_id: "agent-1",
        label: "ETH price",
        app: "research",
        resumed: false,
      },
      {
        type: "task_phase",
        event_id: "task-phase",
        sequence: 2,
        turn_id: "turn-1",
        occurred_at: 2,
        call_id: "call-1",
        agent_id: "agent-1",
        app: "research",
        phase: "task_completed",
        elapsed_ms: 100,
        observed_at_ms: 2,
      },
      {
        type: "task_activity",
        event_id: "task-tool",
        sequence: 3,
        turn_id: "turn-1",
        occurred_at: 3,
        call_id: "call-1",
        agent_id: "agent-1",
        child_seq: 1,
        kind: "tool_call",
        tool_name: "brave_search",
        args: {},
        result_preview: "search result",
      },
      {
        type: "task_completed",
        event_id: "task-completed",
        sequence: 4,
        turn_id: "turn-1",
        occurred_at: 4,
        call_id: "call-1",
        agent_id: "agent-1",
        status: "completed",
        message: "ETH spot price: **$2,502.20 USD**",
        staged_count: 0,
        steps: 1,
        duration_ms: 100,
      },
    ] as Event[];

    const { container } = render(<ActivitySidebar />);
    expect(
      screen.getByRole("status", { name: "Completed" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    expect(screen.queryByText("task_completed")).not.toBeInTheDocument();
    expect(screen.queryByText("brave search")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /ETH price/ });
    const content = container.querySelector(
      '[data-subagent-content="agent-1"]',
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveClass("grid-rows-[0fr]", "opacity-0");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveClass("grid-rows-[1fr]", "opacity-100");
    expect(screen.getByText("$2,502.20 USD").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*\$2,502/)).not.toBeInTheDocument();
  });

  it("shows a spinner instead of Working text for an active subagent", () => {
    runtime.pendingActions = [];
    runtime.events = [
      {
        type: "task_started",
        event_id: "task-started",
        sequence: 1,
        turn_id: "turn-1",
        occurred_at: 1,
        call_id: "call-1",
        agent_id: "agent-1",
        label: "ETH price",
        app: "research",
        resumed: false,
      },
    ] as Event[];

    render(<ActivitySidebar />);
    expect(screen.getByRole("status", { name: "Working" })).toBeInTheDocument();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
  });
});

describe("unified live transaction review", () => {
  beforeEach(() => {
    runtime.events = [];
    runtime.pendingActions = [];
    runtime.commits = [];
    runtime.actionAttempts.clear();
    runtime.isRunning = false;
    runtime.executeAction.mockReset().mockResolvedValue(undefined);
    runtime.rejectAction.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);
  function transfer(id: string) {
    return {
      ...action({
        type: "execute_evm",
        transactions: [
          {
            chain_id: 8453,
            from: "0x123",
            to: "0x456",
            data: "0x",
            label: `Send ${id}`,
            kind: "transfer",
          },
        ],
        simulation: simulation(),
      }),
      id,
    };
  }
  it("reviews only the head request once and advances to the next request", async () => {
    const first = transfer("first"),
      second = transfer("second");
    runtime.pendingActions = [first, second];
    runtime.events = [first, second];
    const { rerender } = render(<ActivitySidebar />);
    expect(screen.getAllByText("Send first")).toHaveLength(1);
    expect(screen.queryByTestId("transaction-step")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Transactions/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Wallet request: 1 transaction/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(runtime.executeAction).toHaveBeenCalledWith("first"),
    );
    runtime.pendingActions = [second];
    runtime.events = [
      {
        ...first,
        state: "rejected",
        result: { status: "rejected", reason: "No" },
      },
      second,
    ];
    rerender(<ActivitySidebar />);
    expect(screen.getByTestId("transaction-review")).toHaveAttribute(
      "data-action-id",
      "second",
    );
    expect(screen.getAllByTestId("activity-transaction")).toHaveLength(2);
  });
  it("keeps a failed durable request rejectable without offering signing", async () => {
    const failed = transfer("failed");
    if (failed.request.type !== "execute_evm") throw new Error("fixture");
    failed.request.simulation.status = "failed";
    runtime.pendingActions = [failed];
    runtime.events = [failed];
    render(<ActivitySidebar />);
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Transactions/ }),
    ).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    await waitFor(() =>
      expect(runtime.rejectAction).toHaveBeenCalledWith(
        "failed",
        "Request rejected",
      ),
    );
  });
  it("retains completed transactions across newer turns in the unified list", () => {
    const past = { ...transfer("past"), state: "completed" as const };
    runtime.events = [
      past,
      {
        type: "message",
        event_id: "new-message",
        turn_id: "new-turn",
        sequence: 3,
        occurred_at: 3,
        sender: "user",
        content: "Hello",
      } as Event,
    ];
    render(<ActivitySidebar />);
    expect(screen.queryByText("Past transactions")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Transactions 1" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Send past")).toBeInTheDocument();
    expect(screen.queryByTestId("transaction-review")).not.toBeInTheDocument();
  });
  it("orders mixed transaction history newest first without duplicates", () => {
    const older = {
      ...transfer("older"),
      sequence: 1,
      state: "completed" as const,
    };
    const newest = { ...transfer("newest"), sequence: 9 };
    const middle = {
      ...transfer("middle"),
      sequence: 5,
      state: "rejected" as const,
    };
    runtime.events = [middle, newest, older];
    runtime.pendingActions = [newest];
    render(<ActivitySidebar />);
    const rows = screen.getAllByTestId("activity-transaction");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Send newest");
    expect(rows[1]).toHaveTextContent("Send middle");
    expect(rows[2]).toHaveTextContent("Send older");
    expect(screen.queryByText("Past transactions")).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Transactions, newest batch first; signing order within each batch",
      }),
    ).toHaveStyle({ height: "272px" });
  });
  it("keeps an older batch behind newer work after a result revision", () => {
    const older = { ...transfer("older"), sequence: 2 };
    const newer = { ...transfer("newer"), sequence: 5 };
    runtime.events = [
      older,
      newer,
      { ...older, sequence: 8, revision: 2, state: "completed" },
    ];
    runtime.pendingActions = [newer];

    render(<ActivitySidebar />);
    const rows = screen.getAllByTestId("activity-transaction");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Send newer");
    expect(rows[1]).toHaveTextContent("Send older");
  });
  it("shows a signing batch in execution order", () => {
    const requestTransactions = [
      "Redeem all Morpho shares",
      "Approve main Spoke to spend USDC",
      "Aave V4 supply on the main Spoke",
    ].map((label, index) => ({
      chain_id: 5042,
      from: "0x123",
      to: `0x${index + 1}`,
      data: "0x",
      label,
      kind: "transaction",
    }));
    const batch = action({
      type: "execute_evm",
      transactions: requestTransactions,
      simulation: simulation(),
    });
    batch.sequence = 4;
    const staged = requestTransactions.map(
      (tx, index) =>
        ({
          type: "message",
          event_id: `stage-${index + 1}`,
          sequence: index + 1,
          turn_id: batch.turn_id,
          occurred_at: index + 1,
          sender: "agent",
          content: "",
          tool_name: "evm_stage_tx",
          tool_result: [
            "evm_stage_tx",
            JSON.stringify({
              ...tx,
              pending_tx_id: index + 1,
              current_lifecycle: "queued",
            }),
          ],
        }) as Event,
    );
    runtime.events = [...staged, batch];
    runtime.pendingActions = [batch];

    const view = render(<ActivitySidebar />);

    const labels = () =>
      screen
        .getAllByTestId("activity-transaction")
        .map((row) => row.querySelector("[title]")?.getAttribute("title"));
    const expected = [
      "Redeem all Morpho shares",
      "Approve main Spoke to spend USDC",
      "Aave V4 supply on the main Spoke",
    ];
    expect(labels()).toEqual(expected);

    runtime.events = staged;
    runtime.pendingActions = [];
    runtime.commits = requestTransactions.map(
      (_, index): CommitView => ({
        version: 1,
        commit_id: `commit-${index + 1}`,
        thread_id: "thread-1",
        stage_id: `evm:${index + 1}`,
        chain_family: "evm",
        chain_ref: "5042",
        signer: "0x123",
        broadcaster: "wallet",
        state: "confirmed",
        transaction_id: `0x${index + 1}`,
        failure_code: null,
        batch: {
          batch_id: "batch-1",
          index,
          ordered_stage_ids: requestTransactions.map((_, i) => `evm:${i + 1}`),
          ordered_commit_ids: requestTransactions.map(
            (_, i) => `commit-${i + 1}`,
          ),
          sources: [
            {
              thread_id: "thread-1",
              chain_family: "evm",
              chain_ref: "5042",
              stage_id: `evm:${index + 1}`,
              source_id: index + 1,
            },
          ],
          predecessor_commit_id: index === 0 ? null : `commit-${index}`,
          review_digest: "review",
        },
        review: null,
        wallet_attempt: null,
        action: null,
      }),
    );
    view.rerender(<ActivitySidebar />);
    expect(labels()).toEqual(expected);
    expect(screen.getAllByTitle("Signed")).toHaveLength(3);

    runtime.commits = runtime.commits.map((commit, index) =>
      index === 0
        ? {
            ...commit,
            continuation: {
              version: 1 as const,
              state: "assistant_recovery_required" as const,
              attempts: 2,
              reason_code: "effect_reconciliation_required" as const,
            },
          }
        : commit,
    );
    view.rerender(<ActivitySidebar />);
    expect(
      screen.queryByText(
        "Redeem all Morpho shares: Assistant response needs recovery",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Signed")).toHaveLength(3);

    runtime.commits = runtime.commits.map((commit, index) => ({
      ...commit,
      batch: commit.batch && { ...commit.batch, index: [2, 0, 1][index] },
    }));
    view.rerender(<ActivitySidebar />);
    expect(labels()).toEqual([expected[1], expected[2], expected[0]]);
    runtime.commits = runtime.commits.map((commit) =>
      commit.continuation
        ? {
            ...commit,
            continuation: {
              ...commit.continuation,
              state: "completed" as const,
            },
          }
        : commit,
    );
    view.rerender(<ActivitySidebar />);
    expect(screen.queryByText(/Assistant response needs recovery/)).toBeNull();
  });
  it("expands the shared list and distinguishes pending from finalized without Review labels", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...transfer(`item-${i}`),
      sequence: i + 1,
      state: i === 4 ? ("pending" as const) : ("completed" as const),
    }));
    runtime.events = items;
    runtime.pendingActions = [items[4]];
    render(<ActivitySidebar />);
    expect(
      screen.queryByText("Review", { exact: true }),
    ).not.toBeInTheDocument();
    const rows = screen.getAllByTestId("activity-transaction");
    expect(rows[0]).toHaveClass("border-dashed");
    expect(rows[1]).not.toHaveClass("border-dashed");
    const expand = screen.getByRole("button", {
      name: "Show all 5 transactions",
    });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    const less = screen.getByRole("button", {
      name: "Show fewer transactions",
    });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("activity-transaction")).toHaveLength(5);
    fireEvent.click(less);
    expect(
      screen.getByRole("button", { name: "Show all 5 transactions" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(runtime.executeAction).not.toHaveBeenCalled();
  });
});
