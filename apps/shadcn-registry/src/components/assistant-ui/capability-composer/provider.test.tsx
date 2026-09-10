import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityComposerProvider, useCapabilityComposer } from "./provider";

const fixture = vi.hoisted(() => ({
  runConfig: { custom: { preserved: "host setting" } } as {
    custom: Record<string, unknown>;
  },
  mode: "auto" as "auto" | "direct",
  sent: [] as unknown[],
  getAuthorizedApps: vi.fn(async () => []),
  onAgentModeSelect: vi.fn(),
  onAgentTargetSelect: vi.fn(),
}));
vi.mock("@assistant-ui/react", () => ({
  useComposerRuntime: () => runtime,
}));
vi.mock("@aomi-labs/react", () => ({
  useControl: () => fixture,
  useThreadContext: () => ({
    currentThreadId: "thread-a",
    threadViewKey: "thread-a",
    getThreadMetadata: () => ({
      control: { agentMode: fixture.mode, app: "default" },
    }),
  }),
}));
const runtime = {
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
            token: "◇ Base",
          })
        }
      >
        Choose Base
      </button>
      <button onClick={() => composer.retainMentions(new Set())}>
        Remove Base
      </button>
      <button onClick={() => fixture.sent.push(fixture.runConfig)}>
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
    </CapabilityComposerProvider>
  );
}

beforeEach(() => {
  fixture.runConfig = { custom: { preserved: "host setting" } };
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
