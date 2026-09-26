import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceResultView } from "./resource-result";

const mock = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("@aomi-labs/react", () => ({
  useOptionalAomiRuntime: () => mock.runtime,
}));
const envelope = {
  resource: {
    uri: "aomi://main/results/00000000000000000000000000000001",
    kind: "data.json@1",
    name: "Vault history",
  },
  summary: { row_count: 20 },
  resources: {},
};
const read = {
  resource: envelope.resource,
  view: "content",
  summary: envelope.summary,
  content: "<script>secret body</script>",
  complete: false,
  next_cursor: "part-2",
};

describe("resource inspection", () => {
  beforeEach(() => {
    mock.runtime = undefined;
  });

  it("shows issued links without adding a mandatory provider or fetching", () => {
    render(<ResourceResultView result={envelope} />);
    expect(screen.getByText("Vault history")).toBeInTheDocument();
    expect(screen.queryByText("Inspect")).not.toBeInTheDocument();
  });

  it("reads only on user inspection, shows untrusted content as text and follows bounded pages", async () => {
    const fetch = vi.fn().mockResolvedValue(read);
    mock.runtime = { currentThreadId: "thread", resources: { read: fetch } };
    render(<ResourceResultView result={envelope} />);
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("Inspect"));
    });
    expect(fetch).toHaveBeenCalledWith(
      "thread",
      envelope.resource.uri,
      expect.objectContaining({
        view: "content",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      screen.getByText('"<script>secret body</script>"'),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByText("Next page"));
    });
    expect(fetch.mock.calls[1][2].cursor).toBe("part-2");
  });

  it("aborts and discards an old thread read after switching", async () => {
    let finish!: (value: typeof read) => void;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const resources = { read: fetch };
    mock.runtime = { currentThreadId: "first", resources };
    const view = render(<ResourceResultView result={envelope} />);
    fireEvent.click(screen.getByText("Inspect"));
    const signal: AbortSignal = fetch.mock.calls[0][2].signal;
    mock.runtime = { currentThreadId: "second", resources };
    view.rerender(<ResourceResultView result={envelope} />);
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(read);
    });
    expect(
      screen.queryByText('"<script>secret body</script>"'),
    ).not.toBeInTheDocument();
  });

  it("clears a loaded body when the principal or application scope changes on the same thread", async () => {
    const resources = { read: vi.fn().mockResolvedValue(read) };
    mock.runtime = {
      currentThreadId: "thread",
      resourceScopeKey: "app-a:user-a",
      resources,
    };
    const view = render(<ResourceResultView result={envelope} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Inspect"));
    });
    expect(
      screen.getByText('"<script>secret body</script>"'),
    ).toBeInTheDocument();
    mock.runtime = {
      currentThreadId: "thread",
      resourceScopeKey: "app-b:user-b",
      resources,
    };
    view.rerender(<ResourceResultView result={envelope} />);
    expect(
      screen.queryByText('"<script>secret body</script>"'),
    ).not.toBeInTheDocument();
    expect(resources.read).toHaveBeenCalledTimes(1);
  });

  it.each(["principal", "application", "thread"])(
    "ignores a late read after %s changes even when the transport ignores abort",
    async (changed) => {
      let finish!: (value: typeof read) => void;
      const fetch = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const resources = { read: fetch };
      mock.runtime = {
        currentThreadId: "thread-a",
        resourceScopeKey: "principal-a:application-a",
        resources,
      };
      const view = render(<ResourceResultView result={envelope} />);
      fireEvent.click(screen.getByText("Inspect"));
      const signal: AbortSignal = fetch.mock.calls[0][2].signal;
      mock.runtime = {
        currentThreadId: changed === "thread" ? "thread-b" : "thread-a",
        resourceScopeKey:
          changed === "principal"
            ? "principal-b:application-a"
            : changed === "application"
              ? "principal-a:application-b"
              : "principal-a:application-a",
        resources,
      };
      view.rerender(<ResourceResultView result={envelope} />);
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish(read);
      });
      expect(
        screen.queryByText('"<script>secret body</script>"'),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Inspect")).toBeEnabled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("renders a gone-resource rejection and permits explicit retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("resource_gone"));
    mock.runtime = { currentThreadId: "thread", resources: { read: fetch } };
    render(<ResourceResultView result={envelope} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Inspect"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("resource_gone");
    expect(screen.getByText("Inspect")).toBeEnabled();
  });
});

it("shows native-stage links from the declared event sidechannel without reading raw payloads", () => {
  const fetch = vi.fn();
  const raw = {
    pending_tx_id: 4,
    from: "wallet",
    to: "recipient",
    data: "0x" + "ab".repeat(4096),
  };
  const nativeEnvelope = {
    ...envelope,
    resource: {
      ...envelope.resource,
      kind: "evm.staged-transaction@1",
      name: "Staged EVM transfer",
    },
    summary: { action: "stage", transaction_count: 1 },
  };
  mock.runtime = {
    currentThreadId: "thread",
    resources: { read: fetch },
    events: [
      {
        type: "message",
        sender: "agent",
        tool_call_id: "native-stage",
        tool_name: "evm_stage_tx",
        tool_result: ["evm_stage_tx", JSON.stringify(raw)],
        model_output: nativeEnvelope,
      },
    ],
  };
  render(<ResourceResultView result={raw} toolCallId="native-stage" />);
  expect(screen.getByText("Staged EVM transfer")).toBeInTheDocument();
  expect(screen.getByText("Inspect")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(raw.data);
  expect(raw.pending_tx_id).toBe(4);
});
