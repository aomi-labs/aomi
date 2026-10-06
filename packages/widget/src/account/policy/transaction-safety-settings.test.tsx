import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionSafetyPolicy } from "@aomi-labs/client";

const state = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/account/transport", () => ({
  useShellTransport: () => ({ json: state.request }),
}));
import { TransactionSafetySettings } from "./transaction-safety-settings";

const account: TransactionSafetyPolicy = {
  mode: "balanced",
  revision: 1,
  scope: "account_default",
  source: "default",
};

const puts = () =>
  state.request.mock.calls.filter(([, options]) => options?.method === "PUT");

beforeEach(() => {
  state.request.mockReset().mockResolvedValue(account);
});

describe("default transaction safety", () => {
  it("reads only the account default, never a chat or Swig policy", async () => {
    render(<TransactionSafetySettings />);
    expect(
      await screen.findByRole("radio", { name: "Balanced" }),
    ).toHaveAttribute("aria-checked", "true");
    const paths = state.request.mock.calls.map(([path]) => String(path));
    expect(paths).toEqual(["/api/account/transaction-safety"]);
    expect(screen.queryByText(/this chat/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  it("saves on change through the account endpoint with the loaded revision", async () => {
    let settle!: (policy: TransactionSafetyPolicy) => void;
    state.request.mockImplementation((_path: string, options?: RequestInit) =>
      options?.method === "PUT"
        ? new Promise<TransactionSafetyPolicy>((resolve) => {
            settle = resolve;
          })
        : Promise.resolve(account),
    );
    render(<TransactionSafetySettings />);
    fireEvent.click(await screen.findByRole("radio", { name: "Strict" }));

    expect(state.request).toHaveBeenCalledWith(
      "/api/account/transaction-safety",
      expect.objectContaining({
        method: "PUT",
        headers: undefined,
        body: JSON.stringify({ mode: "guarded_only", expectedRevision: 1 }),
      }),
    );
    const strict = screen.getByRole("radio", { name: "Strict" });
    expect(strict).toHaveAccessibleDescription(
      /Only actions a protocol guard covers/,
    );

    await act(async () =>
      settle({ ...account, mode: "guarded_only", revision: 2 }),
    );
    expect(screen.getByRole("radio", { name: "Strict" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows a save in flight inside the rows, never as a status line", async () => {
    let settle!: (policy: TransactionSafetyPolicy) => void;
    state.request.mockImplementation((_path: string, options?: RequestInit) =>
      options?.method === "PUT"
        ? new Promise<TransactionSafetyPolicy>((resolve) => {
            settle = resolve;
          })
        : Promise.resolve(account),
    );
    render(<TransactionSafetySettings />);
    fireEvent.click(await screen.findByRole("radio", { name: "Strict" }));

    // The row being saved swaps its check for a spinner; every row is locked.
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    const strict = screen.getByRole("radio", { name: "Strict" });
    expect(strict).toHaveAttribute("aria-checked", "true");
    expect(strict.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () =>
      settle({ ...account, mode: "guarded_only", revision: 2 }),
    );
    expect(screen.getByRole("radiogroup")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("radio", { name: "Balanced" })).toBeEnabled();
    expect(
      screen
        .getByRole("radio", { name: "Strict" })
        .querySelector(".animate-spin"),
    ).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Saved|Saving/)).toBeNull();
  });

  it("moves between the default-able policies with arrow keys", async () => {
    state.request.mockImplementation((_path: string, options?: RequestInit) =>
      Promise.resolve(
        options?.method === "PUT"
          ? { ...account, mode: "guarded_only", revision: 2 }
          : account,
      ),
    );
    render(<TransactionSafetySettings />);
    const balanced = await screen.findByRole("radio", { name: "Balanced" });
    fireEvent.keyDown(balanced, { key: "ArrowDown" });

    // Down from Balanced wraps to Strict: Yolo is never a default.
    expect(state.request).toHaveBeenCalledWith(
      "/api/account/transaction-safety",
      expect.objectContaining({
        body: JSON.stringify({ mode: "guarded_only", expectedRevision: 1 }),
      }),
    );
  });

  it("shows Yolo but never offers it as a default", async () => {
    render(<TransactionSafetySettings />);
    const yolo = await screen.findByRole("radio", { name: "Yolo" });
    expect(yolo).toBeDisabled();
    fireEvent.click(yolo);
    expect(puts()).toHaveLength(0);
    expect(yolo).toHaveAccessibleDescription(/Only inside a chat/);
  });

  it("reloads a conflicting revision and waits for another explicit change", async () => {
    let reads = 0;
    state.request.mockImplementation((_path: string, options?: RequestInit) => {
      if (options?.method === "PUT")
        return Promise.reject(
          new Error("Policy changed in another window. Review and save again."),
        );
      return Promise.resolve(
        ++reads === 1
          ? account
          : { ...account, mode: "guarded_only", revision: 5 },
      );
    });
    render(<TransactionSafetySettings />);
    fireEvent.click(await screen.findByRole("radio", { name: "Strict" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Policy changed in another window",
    );
    await waitFor(() => expect(reads).toBe(2));
    expect(puts()).toHaveLength(1);
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(screen.getByRole("radio", { name: "Strict" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("rejects an unknown mode instead of defaulting", async () => {
    state.request.mockResolvedValue({ ...account, mode: "unknown" });
    render(<TransactionSafetySettings />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
