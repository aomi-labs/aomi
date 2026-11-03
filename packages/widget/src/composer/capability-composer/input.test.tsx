import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AssistantRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useState, type ReactNode } from "react";
import { CapabilityMentionInput } from "./input";

vi.mock("./provider", () => {
  const stable = {
    mentions: [],
    addMention: () => {},
    retainMentions: () => {},
    hintsEnabled: false,
    capabilityPickerRequest: 0,
    consumeCapabilityPickerRequest: () => {},
    appTagRequest: null,
    consumeAppTagRequest: () => {},
  };
  return { useCapabilityComposer: () => stable };
});
vi.mock("./catalog", () => ({ useCapabilityCatalog: () => [] }));

let runtime: AssistantRuntime | undefined;
function Runtime({ children }: { children: ReactNode }) {
  const native = useExternalStoreRuntime({
    messages: [] as ThreadMessageLike[],
    isRunning: false,
    onNew: async () => {},
    convertMessage: (message: ThreadMessageLike) => message,
  });
  runtime = native;
  return (
    <AssistantRuntimeProvider runtime={native}>
      {children}
    </AssistantRuntimeProvider>
  );
}

describe("CapabilityMentionInput without hints", () => {
  it("keeps a draft the composer already holds when it mounts", async () => {
    let show!: (value: boolean) => void;
    function Toggle() {
      const [visible, setVisible] = useState(false);
      show = setVisible;
      return visible ? (
        <CapabilityMentionInput placeholder="Ask" className="" />
      ) : null;
    }
    const view = render(
      <Runtime>
        <Toggle />
      </Runtime>,
    );
    // A failed send puts its text back before the composer remounts.
    act(() => runtime!.thread.composer.setText("hello from template"));
    act(() => show(true));

    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveTextContent(
        "hello from template",
      ),
    );
    expect(runtime!.thread.composer.getState().text).toBe(
      "hello from template",
    );
  });
});
