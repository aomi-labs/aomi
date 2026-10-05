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

describe("chat Rename", () => {
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
    expect(screen.getByLabelText("Saving chat title")).toBeDisabled();
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
    expect(input).toHaveValue("Retry title");
    fireEvent.submit(input.closest("form")!);
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
