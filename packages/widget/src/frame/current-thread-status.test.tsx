import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CurrentThreadStatus } from "./current-thread-status";

const state = vi.hoisted(() => ({
  isRunning: false,
  pendingActions: [] as unknown[],
  commits: [] as { state: string }[],
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
