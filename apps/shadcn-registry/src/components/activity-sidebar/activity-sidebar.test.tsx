import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "@aomi-labs/client";
import { action, runtime, simulation } from "./test-fixtures";
import { ActivitySidebar } from "./activity-sidebar";

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
  it("does not animate an older unresolved request when a new turn is working", () => {
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
    ).toBeNull();
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
      screen.getByText(/Wallet request: 1 transaction/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send to wallet" }));
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
      screen.queryByRole("button", { name: "Send to wallet" }),
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
      screen.getByRole("region", { name: "Transactions, newest first" }),
    ).toHaveStyle({ height: "272px" });
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
