import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LaunchRequestError } from "@aomi-labs/deploy/launch";
import { useDeploymentAttempts } from "./use-deployment-attempts";
import { attemptRequest } from "../attempts";
vi.mock("../attempts", () => ({ attemptRequest: vi.fn() }));
const request = vi.mocked(attemptRequest);
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
beforeEach(() => {
  localStorage.clear();
  request.mockReset();
  request.mockResolvedValue({ attempts: [], nextPage: null });
});
afterEach(cleanup);
describe("browser deployment handoff", () => {
  it("keeps a pending start scoped to its project when navigation happens before acknowledgement", async () => {
    let acknowledge!: (value: unknown) => void;
    request.mockImplementation(async (_id, options) =>
      options?.action === "start"
        ? new Promise((resolve) => {
            acknowledge = resolve;
          })
        : { attempts: [], nextPage: null },
    );
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ id }) => useDeploymentAttempts(id, "alice"),
      { initialProps: { id: 7 }, wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    let operation!: Promise<unknown>;
    act(() => {
      operation = result.current.start("fix/branch");
    });
    expect(result.current.local[0].pending).toBe(true);
    rerender({ id: 8 });
    expect(result.current.local).toEqual([]);
    await act(async () => {
      acknowledge({
        attempt: {
          id: 11,
          branch: "fix/branch",
          commit: "abc",
          status: "queued",
        },
      });
      await operation;
    });
    expect(result.current.local).toEqual([]);
    expect(result.current.attempts).toEqual([]);
    expect(
      client.getQueryData(["deployment-attempts", "alice", 7, "local"]),
    ).toEqual([]);
    expect(request).toHaveBeenCalledWith(7, {
      action: "start",
      branch: "fix/branch",
    });
  });
  it("prevents repeat POSTs while acknowledgement is pending", async () => {
    request.mockImplementation(async (_id, options) =>
      options?.action === "start" ? new Promise(() => {}) : { attempts: [] },
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => {
      void result.current.start("main");
      void result.current.start("main");
    });
    expect(
      request.mock.calls.filter(([, options]) => options?.action === "start"),
    ).toHaveLength(1);
  });
  it("shows the running deployment instead of duplicating it when start finds one", async () => {
    const running = {
      id: 11,
      branch: "main",
      commit: "abc",
      status: "in_progress",
      conclusion: null,
    };
    request.mockImplementation(async (_id, options) =>
      options?.action === "start"
        ? { attempt: running, existing: true }
        : options?.runId
          ? { attempt: running }
          : { attempts: [running], nextPage: null },
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.attempts).toHaveLength(1));
    await act(async () => {
      await result.current.start("main");
    });
    expect(result.current.mutationNotice).toBe(
      "A deployment is already running; showing it",
    );
    expect(result.current.attempts.map((item) => item.id)).toEqual([11]);
    expect(result.current.local).toEqual([]);
  });
  it("preserves an early failure across refresh without pretending it reached CI", async () => {
    request.mockImplementation(async (_id, options) => {
      if (options?.action === "start")
        throw new Error("Commit Cargo.lock before deploying");
      return { attempts: [] };
    });
    const first = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper: setup().wrapper,
    });
    await act(async () => {
      await first.result.current.start("main");
    });
    first.unmount();
    const second = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper: setup().wrapper,
    });
    await waitFor(() =>
      expect(second.result.current.local[0]).toMatchObject({
        pending: false,
        branch: "main",
        message: "Commit Cargo.lock before deploying",
      }),
    );
  });
  it("keeps the Manager's structured reason across refresh so the card can act on it", async () => {
    const deployError = {
      code: "github_app_permission_missing",
      hint: "Grant the Aomi GitHub App `actions: write` on the platform repository, then retry.",
      retryable: false,
    };
    const rawDeployError = {
      ...deployError,
      message: "internal message",
      details: { cause: "internal diagnostic" },
    };
    request.mockImplementation(async (_id, options) => {
      if (options?.action === "start")
        throw new LaunchRequestError(
          "GitHub deployment request returned HTTP 403",
          502,
          {
            error: "GitHub deployment request returned HTTP 403",
            code: "github_app_permission_missing",
            retryable: false,
            deployError: rawDeployError,
          },
        );
      return { attempts: [] };
    });
    const first = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper: setup().wrapper,
    });
    await act(async () => {
      await first.result.current.start("main");
    });
    expect(first.result.current.local[0]).toMatchObject({
      pending: false,
      message: "GitHub deployment request returned HTTP 403",
      deployError,
    });
    first.unmount();
    const second = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper: setup().wrapper,
    });
    await waitFor(() =>
      expect(second.result.current.local[0]).toMatchObject({
        pending: false,
        message: "GitHub deployment request returned HTTP 403",
        deployError,
      }),
    );
  });
  it("drops a saved reason that lost its shape instead of the whole attempt", async () => {
    localStorage.setItem(
      "aomi-build:attempts:alice:7",
      JSON.stringify([
        {
          id: "local-1",
          createdAt: "2026-09-22T00:00:00.000Z",
          branch: "main",
          message: "Could not start deployment",
          pending: false,
          deployError: { code: 403 },
        },
      ]),
    );
    const { result } = renderHook(() => useDeploymentAttempts(7, "alice"), {
      wrapper: setup().wrapper,
    });
    await waitFor(() => expect(result.current.local).toHaveLength(1));
    expect(result.current.local[0]).not.toHaveProperty("deployError");
  });
});
