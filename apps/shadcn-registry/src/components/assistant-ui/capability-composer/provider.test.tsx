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
import type { PickerItem } from "./model";
import type { DirectRoutingApp } from "../routing";
import { AppIndicator } from "../../control-bar/app-indicator";

const fixture = vi.hoisted(() => ({
  text: "",
  setText: vi.fn(),
  items: [] as PickerItem[],
  runConfig: { custom: { preserved: "host setting" } } as {
    custom: Record<string, unknown>;
  },
  threadId: "thread-a",
  onSend: () => {},
  mode: "auto" as "auto" | "direct",
  defaultMode: "auto" as "auto" | "direct",
  directApps: [{ app: "default" }] as DirectRoutingApp[],
  currentApp: { app: "default" } as DirectRoutingApp,
  appTag: undefined as undefined | { app: string; applicationId?: number },
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
  useAuthEndpoints: () => ({
    state: {
      appDescriptors: [
        { name: "default", label: "Basic" },
        { name: "aave", applicationId: 42, metadata: { source: "builtin" } },
        { name: "research", applicationId: 43, label: "Research App" },
      ],
    },
  }),
  useThreadContext: () => ({
    currentThreadId: fixture.threadId,
    threadViewKey: fixture.threadId,
    getThreadMetadata: () => ({
      control: { agentMode: fixture.mode, ...fixture.currentApp },
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
      <AppIndicator app={composer.selectedApp ?? undefined} />
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
            appName: "cambrian",
          })
        }
      >
        Choose Cambrian
      </button>
      <button
        onClick={() =>
          composer.addMention({
            kind: "skill",
            id: "across",
            key: "skill:across",
            label: "Across",
          })
        }
      >
        Choose Across
      </button>
      <button onClick={composer.openCapabilityPicker}>Open picker</button>
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
          { mode: "direct", apps: fixture.directApps },
        ],
        defaultMode: fixture.defaultMode,
      }}
      initialAppTag={fixture.appTag}
    >
      <Composer />
      <CapabilityMentionInput
        placeholder="Message"
        className="aui-composer-input overflow-x-hidden"
      />
    </CapabilityComposerProvider>
  );
}

beforeEach(() => {
  fixture.runConfig = { custom: { preserved: "host setting" } };
  fixture.text = "";
  fixture.items = [];
  localStorage.clear();
  fixture.threadId = "thread-a";
  fixture.mode = "auto";
  fixture.defaultMode = "auto";
  fixture.directApps = [{ app: "default" }];
  fixture.currentApp = { app: "default" };
  fixture.appTag = undefined;
  fixture.sent = [];
  fixture.onAgentModeSelect.mockClear();
  fixture.onAgentTargetSelect.mockClear();
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
  it("removes hints when selection is empty or the host routes Direct", async () => {
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
    fixture.defaultMode = "direct";
    await act(async () => {
      view.rerender(<Harness />);
    });
    expect(fixture.runConfig).toEqual({
      custom: { preserved: "host setting" },
    });
  });
});

describe("host-owned routing", () => {
  it("returns a chat with a stored Direct mode to the host's Auto default", async () => {
    fixture.mode = "direct";
    render(<Harness />);
    await act(async () => {});
    expect(fixture.onAgentModeSelect).toHaveBeenCalledWith("auto", {
      persist: false,
    });
  });

  it("pins the host's Direct app silently", async () => {
    fixture.defaultMode = "direct";
    render(<Harness />);
    await act(async () => {});
    expect(fixture.onAgentTargetSelect).toHaveBeenCalledWith(
      { mode: "direct", app: "default" },
      { persist: false },
    );
  });
});

describe("turn-scoped app mentions", () => {
  it("sends an app hint and clears it with the submitted message", async () => {
    render(<Harness />);
    await act(async () => {
      fireEvent.click(screen.getByText("Choose Cambrian"));
    });
    expect(fixture.runConfig.custom.aomiCapabilityHints).toMatchObject({
      capabilities: [
        { kind: "app", id: "application:2937773", appName: "cambrian" },
      ],
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Send button"));
    });
    expect(fixture.sent[0]).toMatchObject({
      custom: {
        aomiCapabilityHints: {
          capabilities: [{ kind: "app", id: "application:2937773" }],
        },
      },
    });
    expect(screen.getByTestId("selections")).toBeEmptyDOMElement();
    expect(fixture.runConfig.custom.aomiCapabilityHints).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });
  it("does not restore an app in another conversation or on remount", async () => {
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
    expect(screen.getByTestId("selections")).toBeEmptyDOMElement();
    view.unmount();
    render(<Harness />);
    expect(screen.getByTestId("selections")).toBeEmptyDOMElement();
  });
});

it("inserts an app inline at the caret and removes it with Backspace", async () => {
  fixture.items = [
    {
      kind: "app",
      id: "application:2937773",
      key: "app:cambrian",
      label: "Cambrian",
      searchText: "Cambrian",
      Icon: () => <span aria-hidden="true" />,
    },
  ];
  render(<Harness />);
  const editor = screen.getByRole("textbox", { name: "Message input" });
  editor.textContent = "Ask @cam to swap";
  const text = editor.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 8);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  await act(async () => fireEvent.input(editor));
  fireEvent.click(screen.getByRole("option", { name: /Cambrian/ }));

  const mention = editor.querySelector<HTMLElement>("[data-capability-key]");
  expect(mention?.dataset.capabilityKind).toBe("app");
  expect(editor.textContent).toContain("Ask Cambrian to swap");
  expect(editor.firstChild?.textContent).toBe("Ask ");
  expect(fixture.setText).toHaveBeenLastCalledWith("Ask ▦ Cambrian to swap");
  expect(screen.queryByRole("button", { name: "Remove Cambrian" })).toBeNull();

  const trailing = mention?.nextSibling as Text;
  const afterMention = document.createRange();
  afterMention.setStart(trailing, 1);
  afterMention.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(afterMention);
  await act(async () => fireEvent.keyDown(editor, { key: "Backspace" }));
  expect(editor.querySelector("[data-capability-key]")).toBeNull();
  expect(fixture.runConfig.custom.aomiCapabilityHints).toBeUndefined();
});

it("inserts a toolbar-picked app at the current caret, not ahead of the draft", async () => {
  fixture.items = [
    {
      kind: "app",
      id: "application:2937773",
      key: "app:cambrian",
      label: "Cambrian",
      searchText: "Cambrian",
      Icon: () => <span aria-hidden="true" />,
    },
  ];
  render(<Harness />);
  const editor = screen.getByRole("textbox", { name: "Message input" });
  editor.textContent = "Ask to swap";
  const range = document.createRange();
  range.setStart(editor.firstChild!, 4);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  await act(async () => fireEvent.input(editor));
  fireEvent.click(screen.getByText("Open picker"));
  fireEvent.click(screen.getByRole("option", { name: /Cambrian/ }));

  expect(editor.firstChild?.textContent).toBe("Ask ");
  expect(editor.textContent).toBe("Ask Cambrian to swap");
  expect(fixture.setText).toHaveBeenLastCalledWith("Ask ▦ Cambrian to swap");
  expect(screen.getByTestId("selections")).toHaveTextContent("Cambrian");
});

it("clears app and skill mentions together after send", async () => {
  fixture.text = "✦ Across hello";
  const view = render(<Harness />);
  await act(async () => {
    fireEvent.click(screen.getByText("Choose Cambrian"));
    fireEvent.click(screen.getByText("Choose Across"));
  });
  expect(screen.getByTestId("selections").textContent).toBe("Cambrian,Across");
  await act(async () => {
    fireEvent.click(screen.getByText("Send button"));
  });
  fixture.text = "";
  await act(async () => {
    view.rerender(<Harness />);
  });
  expect(screen.getByTestId("selections")).toBeEmptyDOMElement();
  expect(fixture.runConfig.custom.aomiCapabilityHints).toBeUndefined();
});

it("mounts the picker outside the composer overflow boundary", async () => {
  render(<Harness />);
  await act(async () => {
    fireEvent.click(screen.getByText("Open picker"));
  });

  const listbox = screen.getByRole("listbox", {
    name: "Apps, skills, and chains",
  });
  expect(listbox.closest(".overflow-x-hidden")).toBeNull();
});

it("pre-tags a host-requested app once, like a + picker choice", async () => {
  fixture.items = [
    {
      kind: "app",
      id: "application:2937773",
      key: "app:application:2937773",
      label: "Cambrian",
      appName: "cambrian",
      applicationId: 2937773,
      searchText: "Cambrian",
      Icon: () => <span aria-hidden="true" />,
    },
  ];
  fixture.appTag = { app: "cambrian" };
  const view = render(<Harness />);
  await act(async () => {});

  const editor = screen.getByRole("textbox", { name: "Message input" });
  expect(editor.querySelectorAll("[data-capability-key]")).toHaveLength(1);
  expect(screen.getByTestId("selections")).toHaveTextContent("Cambrian");
  expect(fixture.runConfig.custom.aomiCapabilityHints).toMatchObject({
    capabilities: [{ kind: "app", id: "application:2937773" }],
  });

  await act(async () => {
    view.rerender(<Harness />);
  });
  expect(editor.querySelectorAll("[data-capability-key]")).toHaveLength(1);
});

describe("selected app context", () => {
  it("hides allowed Direct apps under Auto, even with a stored Direct target", () => {
    fixture.mode = "direct";
    fixture.currentApp = { applicationId: 42 };
    fixture.directApps = [{ app: "default" }, { applicationId: 42 }];
    render(<Harness />);
    expect(screen.queryByTestId("composer-selected-app")).toBeNull();
  });

  it("shows the active Direct app rather than the first allowed app", () => {
    fixture.mode = "direct";
    fixture.defaultMode = "direct";
    fixture.currentApp = { applicationId: 42 };
    fixture.directApps = [{ app: "default" }, { applicationId: 42 }];
    render(<Harness />);
    const indicator = screen.getByLabelText("Selected app: Aave");
    expect(indicator).toHaveTextContent(/^Aave$/);
    expect(indicator.querySelector("svg")).not.toHaveClass("lucide-app-window");
    expect(fixture.onAgentTargetSelect).not.toHaveBeenCalled();
  });

  it("updates the configured Direct app and clears it on an Auto transition", () => {
    fixture.defaultMode = "direct";
    fixture.directApps = [{ applicationId: 42 }];
    const view = render(<Harness />);
    expect(screen.getByLabelText("Selected app: Aave")).toBeVisible();
    fixture.directApps = [{ applicationId: 43 }];
    view.rerender(<Harness />);
    expect(screen.getByLabelText("Selected app: Research App")).toBeVisible();
    expect(screen.queryByLabelText("Selected app: Aave")).toBeNull();
    fixture.defaultMode = "auto";
    view.rerender(<Harness />);
    expect(screen.queryByTestId("composer-selected-app")).toBeNull();
  });

  it("preserves an explicit Portal tag in Auto and follows host tag changes", () => {
    fixture.appTag = { app: "aave", applicationId: 42 };
    const view = render(<Harness />);
    expect(screen.getByLabelText("Selected app: Aave")).toBeVisible();
    fixture.appTag = { app: "research", applicationId: 43 };
    view.rerender(<Harness />);
    expect(screen.getByLabelText("Selected app: Research App")).toBeVisible();
    expect(screen.queryByLabelText("Selected app: Aave")).toBeNull();
    fixture.appTag = undefined;
    view.rerender(<Harness />);
    expect(screen.queryByTestId("composer-selected-app")).toBeNull();
  });

  it("gives the explicit host tag precedence over a Direct target", () => {
    fixture.defaultMode = "direct";
    fixture.appTag = { app: "research", applicationId: 43 };
    render(<Harness />);
    expect(screen.getByLabelText("Selected app: Research App")).toBeVisible();
    expect(screen.queryByLabelText("Selected app: Basic")).toBeNull();
  });
});
