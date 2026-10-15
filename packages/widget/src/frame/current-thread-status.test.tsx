import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CurrentThreadStatus } from "./current-thread-status";

const state = vi.hoisted(() => ({
  isRunning: false,
  pendingActions: [] as unknown[],
  commits: [] as { state: string; approval?: { state: string } }[],
}));
vi.mock("@aomi-labs/react", () => ({ useOptionalAomiRuntime: () => state }));

beforeEach(() => {
  state.isRunning = false;
  state.pendingActions = [];
  state.commits = [];
});

it("announces work and gives signature waits priority without replacing the status node", () => {
  const { rerender } = render(<CurrentThreadStatus />);
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("data-current-thread-status", "idle");
  state.isRunning = true;
  rerender(<CurrentThreadStatus />);
  expect(status).toHaveTextContent("Working");
  state.pendingActions = [{}];
  rerender(<CurrentThreadStatus />);
  expect(status).toHaveTextContent("Waiting for your signature");
  expect(status).toHaveAttribute("data-current-thread-status", "sign");
  state.pendingActions = [];
  state.commits = [{ state: "needs_signature" }];
  rerender(<CurrentThreadStatus />);
  expect(status).toHaveTextContent("Waiting for your signature");
  state.isRunning = false;
  state.commits = [];
  rerender(<CurrentThreadStatus />);
  expect(status).toBeEmptyDOMElement();
  expect(screen.getByRole("status")).toBe(status);
});

it("announces a commit waiting for approval as an amber wait", () => {
  state.isRunning = true;
  state.commits = [{ state: "awaiting_approval" }];
  render(<CurrentThreadStatus />);
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("data-current-thread-status", "sign");
  expect(status).toHaveTextContent("Waiting for your approval");
});

it("stops waiting once approved: Aomi signs", () => {
  state.isRunning = true;
  state.commits = [
    { state: "needs_signature", approval: { state: "approved" } },
  ];
  render(<CurrentThreadStatus />);
  expect(screen.getByRole("status")).toHaveAttribute(
    "data-current-thread-status",
    "run",
  );
});
