import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ThreadList } from "./thread-list";

const actions = vi.hoisted(() => ({ renameThread: vi.fn() }));
vi.mock("@aomi-labs/react", async () => ({
  ...(await vi.importActual("@aomi-labs/react")),
  useOptionalAomiRuntime: () => actions,
}));

function Harness() {
  const runtime = useExternalStoreRuntime({
    messages: [] as ThreadMessageLike[],
    onNew: vi.fn(),
    convertMessage: (message: ThreadMessageLike) => message,
    adapters: {
      threadList: {
        threadId: "backend-session-123",
        threads: [
          {
            id: "backend-session-123",
            title: "Original title",
            status: "regular",
          },
        ],
        onSwitchToNewThread: vi.fn(),
        onSwitchToThread: vi.fn(),
        onArchive: vi.fn(),
      },
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadList />
    </AssistantRuntimeProvider>
  );
}

async function openRename() {
  fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
  fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
  return screen.getByRole("textbox", { name: "Chat title" });
}

function pointerBoundary(
  element: HTMLElement,
  type: "pointerover" | "pointerout",
  pointerType: string,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    relatedTarget: document.body,
  });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(element, event);
  // Browsers can emit compatibility mouse boundaries after touch input.
  if (type === "pointerout")
    fireEvent.mouseOut(element, { relatedTarget: document.body });
  else fireEvent.mouseOver(element, { relatedTarget: document.body });
}

function setHoverCapability(canHover: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      matches: canHover && media === "(any-hover: hover)",
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("chat Rename", () => {
  it("opens chat options without activating the enclosing row or sidebar", async () => {
    const selectRow = vi.fn();
    render(
      <div onClick={selectRow}>
        <Harness />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
    expect(await screen.findByRole("button", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Archive" })).toBeVisible();
    expect(selectRow).not.toHaveBeenCalled();
  });

  it.each([
    { pointerType: "touch", canHover: false },
    { pointerType: "mouse", canHover: false },
    { pointerType: "touch", canHover: true },
  ])(
    "keeps Rename usable after $pointerType leaves (hover=$canHover)",
    async ({ pointerType, canHover }) => {
      setHoverCapability(canHover);
      try {
        render(<Harness />);
        fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
        const rename = await screen.findByRole("button", { name: "Rename" });
        const row = screen.getByTestId("aomi-thread-item");
        vi.useFakeTimers();
        pointerBoundary(row, "pointerout", pointerType);
        act(() => vi.advanceTimersByTime(500));
        expect(rename).toBeVisible();
        fireEvent.click(rename);
        expect(
          screen.getByRole("textbox", { name: "Chat title" }),
        ).toHaveFocus();
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    },
  );

  it("keeps the desktop hover grace and cancels it while entering the portaled menu", async () => {
    setHoverCapability(true);
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
      const rename = await screen.findByRole("button", { name: "Rename" });
      const menu = rename.closest(
        '[data-slot="popover-content"]',
      ) as HTMLElement;
      vi.useFakeTimers();
      pointerBoundary(
        screen.getByTestId("aomi-thread-item"),
        "pointerout",
        "mouse",
      );
      act(() => vi.advanceTimersByTime(119));
      expect(rename).toBeVisible();
      pointerBoundary(menu, "pointerover", "mouse");
      act(() => vi.advanceTimersByTime(500));
      expect(rename).toBeVisible();
      pointerBoundary(menu, "pointerout", "mouse");
      act(() => vi.advanceTimersByTime(119));
      expect(rename).toBeVisible();
      act(() => vi.advanceTimersByTime(2));
      expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("uses the real external-store session id and submits Enter only once", async () => {
    let resolve!: () => void;
    actions.renameThread.mockReset().mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<Harness />);
    const input = await openRename();
    fireEvent.change(input, { target: { value: "  Saved title  " } });
    const form = input.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(actions.renameThread).toHaveBeenCalledOnce();
    expect(actions.renameThread).toHaveBeenCalledWith(
      "backend-session-123",
      "Saved title",
    );
    expect(screen.queryByLabelText("Chat title")).toBeNull();
    await act(async () => resolve());
    expect(screen.queryByLabelText("Chat title")).toBeNull();
    expect(screen.getByLabelText("Chat options")).toHaveFocus();
  });

  it("keeps the entered title and offers retry when saving fails", async () => {
    actions.renameThread
      .mockReset()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    render(<Harness />);
    const input = await openRename();
    fireEvent.change(input, { target: { value: "Retry title" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't rename"),
    );
    const retryInput = screen.getByRole("textbox", { name: "Chat title" });
    expect(retryInput).toHaveValue("Retry title");
    fireEvent.submit(retryInput.closest("form")!);
    await waitFor(() =>
      expect(screen.queryByLabelText("Chat title")).toBeNull(),
    );
    expect(actions.renameThread).toHaveBeenCalledTimes(2);
  });

  it("disables Save for blank titles and cancels with Escape without sending", async () => {
    actions.renameThread.mockReset();
    render(<Harness />);
    const input = await openRename();
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByLabelText("Save chat title")).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Chat title")).toBeNull();
    expect(actions.renameThread).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Chat options")).toHaveFocus();
  });
});
