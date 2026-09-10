import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityMentionInput } from "./input";
import { CapabilityComposerProvider, useCapabilityComposer } from "./provider";

const fixture = vi.hoisted(() => ({
  text: "",
  setText: vi.fn(),
  items: [],
  runConfig: { custom: { preserved: "host setting" } } as {
    custom: Record<string, unknown>;
  },
  threadId: "thread-a",
  onSend: () => {},
  mode: "auto" as "auto" | "direct",
  sent: [] as unknown[],
  getAuthorizedApps: vi.fn(async () => []),
  onAgentModeSelect: vi.fn(),
  onAgentTargetSelect: vi.fn(),
}));
vi.mock("@assistant-ui/react", () => ({
  useComposerRuntime: () => runtime,
  unstable_useComposerInput: () => ({
    value: fixture.text,
    setText: fixture.setText,
    isDisabled: false,
  }),
}));
vi.mock("@aomi-labs/react", () => ({
  useControl: () => fixture,
  useThreadContext: () => ({
    currentThreadId: fixture.threadId,
    threadViewKey: fixture.threadId,
    getThreadMetadata: () => ({
      control: { agentMode: fixture.mode, app: "default" },
    }),
  }),
}));
vi.mock("./catalog", () => ({ useCapabilityCatalog: () => fixture.items }));
const runtime = {
  unstable_on: (_event: string, callback: () => void) => {
    fixture.onSend = callback;
    return () => {};
  },
  getState: () => ({ runConfig: fixture.runConfig }),
  // Model React-backed configuration: a setter cannot update the send
  // handler's configuration snapshot within the same event.
  setRunConfig: (next: typeof fixture.runConfig) => {
    queueMicrotask(() => {
      fixture.runConfig = next;
    });
  },
};
function Composer() {
  const composer = useCapabilityComposer();
  return (
    <>
      <button
        onClick={() =>
          composer.addMention({
            kind: "chain",
            id: "eip155:8453",
            key: "chain:eip155:8453",
            label: "Base",
          })
        }
      >
        Choose Base
      </button>
      <button onClick={() => composer.retainMentions(new Set())}>
        Remove Base
      </button>
      <button
        onClick={() =>
          composer.addMention({
            kind: "app",
            id: "application:2937773",
            key: "app:cambrian",
            label: "Cambrian",
          })
        }
      >
        Choose Cambrian
      </button>
      <button onClick={() => composer.removeApp("app:cambrian")}>
        Remove app
      </button>
      <span data-testid="selections">
        {composer.mentions.map((item) => item.label).join(",")}
      </span>
      <button
        onClick={() => {
          fixture.sent.push(fixture.runConfig);
          fixture.onSend();
        }}
      >
        Send button
      </button>
      <form
        aria-label="Composer form"
        onSubmit={(event) => {
          composer.prepareSubmit(event);
          event.preventDefault();
          fixture.sent.push(fixture.runConfig);
        }}
      />
    </>
  );
}
function Harness() {
  return (
    <CapabilityComposerProvider
      routing={{
        targets: [
          { mode: "auto" },
          { mode: "direct", apps: [{ app: "default" }] },
        ],
      }}
    >
      <Composer />
      <CapabilityMentionInput placeholder="Message" className="" />
    </CapabilityComposerProvider>
  );
}

beforeEach(() => {
  fixture.runConfig = { custom: { preserved: "host setting" } };
  fixture.text = "";
  localStorage.clear();
  fixture.threadId = "thread-a";
  fixture.mode = "auto";
  fixture.sent = [];
});
afterEach(cleanup);

describe("capability configuration before send", () => {
  it.each(["button", "form"])(
    "prepares selected hints before the %s send event",
    async (kind) => {
      render(<Harness />);
      await act(async () => {
        fireEvent.click(screen.getByText("Choose Base"));
      });
      if (kind === "button") fireEvent.click(screen.getByText("Send button"));
      else
        fireEvent.submit(screen.getByRole("form", { name: "Composer form" }));
      expect(fixture.sent).toEqual([
        {
          custom: {
            preserved: "host setting",
            aomiCapabilityHints: {
              capabilities: [{ kind: "chain", id: "eip155:8453" }],
            },
          },
        },
      ]);
    },
  );
  it("removes hints when selection is empty or mode becomes Direct", async () => {
    const view = render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Base"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Remove Base"));
    });
    expect(fixture.runConfig).toEqual({
      custom: { preserved: "host setting" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Base"));
    });
    fixture.mode = "direct";
    await act(async () => {
      view.rerender(<Harness />);
    });
    expect(fixture.runConfig).toEqual({
      custom: { preserved: "host setting" },
    });
  });
});

describe("persistent app selections", () => {
  it("keeps apps after send and sends removal exactly once", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Cambrian"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Send button"));
    });
    expect(screen.getByTestId("selections").textContent).toBe("Cambrian");
    await act(async () => {
      fireEvent.click(screen.getByText("Remove app"));
    });
    expect(fixture.runConfig.custom.aomiCapabilityHints).toMatchObject({
      removedApps: [{ id: "application:2937773" }],
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Send button"));
    });
    expect(fixture.sent[1]).toMatchObject({
      custom: {
        aomiCapabilityHints: { removedApps: [{ id: "application:2937773" }] },
      },
    });
    expect(fixture.runConfig.custom.aomiCapabilityHints).toBeUndefined();
  });
  it("restores each conversation and clears pending removal on reselection", async () => {
    const view = render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Cambrian"));
    });
    fixture.threadId = "thread-b";
    await act(async () => {
      view.rerender(<Harness />);
    });
    expect(screen.getByTestId("selections").textContent).toBe("");
    fixture.threadId = "thread-a";
    await act(async () => {
      view.rerender(<Harness />);
    });
    expect(screen.getByTestId("selections").textContent).toBe("Cambrian");
    await act(async () => {
      fireEvent.click(screen.getByText("Remove app"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Cambrian"));
    });
    expect(fixture.runConfig.custom.aomiCapabilityHints).not.toHaveProperty(
      "removedApps",
    );
    view.unmount();
    render(<Harness />);
    expect(screen.getByTestId("selections").textContent).toBe("Cambrian");
  });
});

it.each(["chip", "input"])(
  "keeps the app after text clears and supports Delete from %s",
  async (target) => {
    const view = render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Cambrian"));
    });
    expect(
      screen.getByRole("button", { name: "Remove Cambrian" }),
    ).toBeVisible();
    fixture.text = "search USDC";
    await act(async () => {
      view.rerender(<Harness />);
    });
    fixture.text = "";
    await act(async () => {
      view.rerender(<Harness />);
    });
    const chip = screen.getByRole("button", { name: "Remove Cambrian" });
    expect(chip).toBeVisible();
    await act(async () => {
      fireEvent.keyDown(
        target === "chip"
          ? chip
          : screen.getByRole("textbox", { name: "Message input" }),
        { key: "Delete" },
      );
    });
    expect(
      screen.queryByRole("button", { name: "Remove Cambrian" }),
    ).toBeNull();
    expect(fixture.runConfig.custom.aomiCapabilityHints).toHaveProperty(
      "removedApps",
    );
  },
);
