import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionSafetyPolicy } from "@aomi-labs/client";

const state = vi.hoisted(() => ({
  request: vi.fn(),
  threadId: "actual-chat",
  auto: false,
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => ({ currentThreadId: state.threadId }),
}));
vi.mock("../../transport", () => ({
  useShellTransport: () => ({ json: state.request }),
}));
import { TransactionSafetySettings } from "./transaction-safety-settings";
const thread: TransactionSafetyPolicy = {
  mode: "balanced",
  revision: 3,
  scope: "thread",
  source: "user",
};
const account: TransactionSafetyPolicy = {
  mode: "balanced",
  revision: 1,
  scope: "account_default",
  source: "default",
};
beforeEach(() => {
  state.threadId = "actual-chat";
  state.request
    .mockReset()
    .mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/thread/transaction-safety"
          ? thread
          : path === "/api/account/transaction-safety"
            ? account
            : { signing_policies: [] },
      ),
    );
});
describe("independent transaction safety settings", () => {
  it("loads without any Swig binding and selects the real active chat", async () => {
    render(<TransactionSafetySettings />);
    expect(
      await screen.findByRole("radio", { name: /Balanced/ }),
    ).toBeChecked();
    expect(state.request).toHaveBeenCalledWith(
      "/api/thread/transaction-safety",
      expect.objectContaining({
        headers: {
          "X-Thread-Id": "actual-chat",
          "X-Session-Id": "actual-chat",
        },
      }),
    );
    expect(
      state.request.mock.calls.some(([path]) => String(path).includes("swig")),
    ).toBe(false);
  });
  it("confirms Danger once and waits for authoritative response before claiming saved", async () => {
    let settle!: (policy: TransactionSafetyPolicy) => void;
    const saved = new Promise<TransactionSafetyPolicy>((resolve) => {
      settle = resolve;
    });
    state.request.mockImplementation((path: string, options?: RequestInit) =>
      options?.method === "PUT"
        ? saved
        : Promise.resolve(
            path === "/api/thread/transaction-safety"
              ? thread
              : path === "/api/account/transaction-safety"
                ? account
                : { signing_policies: [{ mode: "auto" }] },
          ),
    );
    render(<TransactionSafetySettings />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Balanced/ })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Danger mode/ }));
    expect(
      screen.getByRole("button", { name: "Set default for new chats" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save for this chat" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "automatically under your existing grant",
    );
    expect(
      state.request.mock.calls.some(([, options]) => options?.method === "PUT"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Enable Danger mode" }));
    expect(screen.queryByText(/Safety policy saved/)).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Balanced/ })).toBeDisabled();
    await act(async () =>
      settle({ ...thread, mode: "unrestricted", revision: 4 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "saved for this chat",
    );
    expect(state.request).toHaveBeenCalledWith(
      "/api/thread/transaction-safety",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ mode: "unrestricted", expectedRevision: 3 }),
      }),
    );
  });
  it("rejects unknown modes and unavailable preferences instead of defaulting", async () => {
    state.request.mockResolvedValue({ ...thread, mode: "unknown" });
    render(<TransactionSafetySettings />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save for this chat" }),
    ).toBeDisabled();
  });
  it("reloads a conflicting revision and waits for another explicit save", async () => {
    let reads = 0;
    state.request.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method === "PUT")
        return Promise.reject(
          new Error("Policy changed in another window. Review and save again."),
        );
      if (path === "/api/thread/transaction-safety")
        return Promise.resolve(
          ++reads === 1
            ? thread
            : { ...thread, mode: "guarded_only", revision: 5 },
        );
      return Promise.resolve(
        path === "/api/account/transaction-safety"
          ? account
          : { signing_policies: [] },
      );
    });
    render(<TransactionSafetySettings />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Balanced/ })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Guarded only/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save for this chat" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Policy changed in another window",
    );
    await waitFor(() => expect(reads).toBe(2));
    expect(
      state.request.mock.calls.filter(
        ([, options]) => options?.method === "PUT",
      ),
    ).toHaveLength(1);
    expect(screen.queryByText(/Safety policy saved/)).not.toBeInTheDocument();
  });
  it("returns focus to the save control after canceling Danger enablement", async () => {
    render(<TransactionSafetySettings />);
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Balanced/ })).toBeChecked(),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Danger mode/ }));
    const save = screen.getByRole("button", { name: "Save for this chat" });
    save.focus();
    fireEvent.click(save);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(save).toHaveFocus());
    expect(
      state.request.mock.calls.some(([, options]) => options?.method === "PUT"),
    ).toBe(false);
  });
});
