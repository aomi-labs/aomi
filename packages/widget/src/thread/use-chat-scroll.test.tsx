import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { ChatViewContext } from "../../../react/src/state/use-chat-view";
import {
  createChatViewStore,
  type ChatViewStore,
} from "../../../react/src/state/chat-view-store";
import { useChatScroll } from "./use-chat-scroll";

let height = 2000;
const resizes = new Set<() => void>();
const descriptors = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  vi.useFakeTimers();
  height = 2000;
  resizes.clear();
  for (const property of ["scrollHeight", "clientHeight", "scrollTo"])
    descriptors.set(
      property,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, property),
    );
  Object.defineProperties(HTMLElement.prototype, {
    scrollHeight: {
      configurable: true,
      get() {
        return this.dataset?.testid === "viewport" ? height : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get() {
        return this.dataset?.testid === "viewport" ? 300 : 0;
      },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        this.scrollTop = Math.min(height - 300, Number(options.top));
        fireEvent.scroll(this);
      },
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {
        resizes.add(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizes.delete(this.callback);
      }
    },
  );
});
afterEach(() => {
  for (const [property, descriptor] of descriptors) {
    if (descriptor)
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, property);
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Viewport() {
  const scroll = useChatScroll(false);
  return (
    <ThreadPrimitive.Root>
      <ThreadPrimitive.Viewport
        {...scroll.viewportProps}
        autoScroll={scroll.autoScroll}
        data-testid="viewport"
      >
        <div>Actual native viewport content</div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
function Fixture({
  store,
  id = "a",
  running = false,
}: {
  store: ChatViewStore;
  id?: string;
  running?: boolean;
}) {
  const view = useMemo(() => ({ store, threadId: id }), [store, id]);
  const runtime = useExternalStoreRuntime({
    messages: [
      {
        id: `${id}-message`,
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Native scroll fixture" }],
      },
    ],
    isRunning: running,
    onNew: async () => {},
    convertMessage: (message) => message,
  });
  return (
    <ChatViewContext.Provider value={view}>
      <AssistantRuntimeProvider runtime={runtime}>
        <Viewport key={id} />
      </AssistantRuntimeProvider>
    </ChatViewContext.Provider>
  );
}
const frames = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
const resize = () =>
  act(() => {
    for (const callback of resizes) callback();
  });

describe("saved scroll with the native assistant viewport", () => {
  it("keeps a restored reader on A→B→A after native initialize/switch frames and content growth", async () => {
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 100, atBottom: false } });
    const view = render(<Fixture store={store} />);
    const viewport = () => view.getByTestId("viewport");
    fireEvent.scroll(viewport());
    await frames();
    expect(viewport().scrollTop).toBe(100);
    height = 2200;
    resize();
    expect(viewport().scrollTop).toBe(100);
    view.rerender(<Fixture store={store} id="b" />);
    await frames();
    expect(viewport().scrollTop).toBe(1900);
    view.rerender(<Fixture store={store} id="a" />);
    fireEvent.scroll(viewport());
    await frames();
    expect(viewport().scrollTop).toBe(100);
    expect(store.get("a")?.scroll).toEqual({ top: 100, atBottom: false });
    height = 2500;
    resize();
    expect(viewport().scrollTop).toBe(100);
  });

  it("keeps saved bottom-follow and freshly admitted live run scrolling", async () => {
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 1700, atBottom: true } });
    const view = render(<Fixture store={store} />);
    const viewport = view.getByTestId("viewport");
    await frames();
    expect(viewport.scrollTop).toBe(1700);
    height = 2300;
    resize();
    expect(viewport.scrollTop).toBe(2000);
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    height = 2500;
    resize();
    expect(viewport.scrollTop).toBe(100);
    view.rerender(<Fixture store={store} running />);
    await frames();
    expect(viewport.scrollTop).toBe(2200);
  });
});
