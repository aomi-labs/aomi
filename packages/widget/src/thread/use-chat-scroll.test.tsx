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
  for (const property of [
    "scrollHeight",
    "clientHeight",
    "scrollTo",
    "scrollTop",
  ])
    descriptors.set(
      property,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, property),
    );
  const offsets = new WeakMap<HTMLElement, number>();
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get() {
        return offsets.get(this) ?? 0;
      },
      set(value: number) {
        offsets.set(this, Math.max(0, Math.min(value, height - 300)));
      },
    },
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
  ready = true,
}: {
  store: ChatViewStore;
  id?: string;
  running?: boolean;
  ready?: boolean;
}) {
  const view = useMemo(() => ({ store, threadId: id }), [store, id]);
  const runtime = useExternalStoreRuntime({
    messages: ready
      ? [
          {
            id: `${id}-message`,
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "Native scroll fixture" }],
          },
        ]
      : [],
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

  it("restores after the transcript gains its initial layout", async () => {
    height = 0;
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 100, atBottom: false } });
    const view = render(<Fixture store={store} />);
    const node = view.getByTestId("viewport");
    // The browser clamps the early write while native runtime messages mount.
    expect(node.scrollTop).toBe(0);
    height = 2000;
    resize();
    await frames();
    expect(node.scrollTop).toBe(100);
  });

  it("restores when native cached messages arrive after the initialization frame", async () => {
    height = 0;
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 100, atBottom: false } });
    const view = render(<Fixture store={store} ready={false} />);
    await frames();
    expect(view.getByTestId("viewport").scrollTop).toBe(0);
    height = 2000;
    view.rerender(<Fixture store={store} ready />);
    await frames();
    expect(view.getByTestId("viewport").scrollTop).toBe(100);
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

  it("restores bottom after cached native messages arrive late", async () => {
    height = 0;
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 1700, atBottom: true } });
    const view = render(<Fixture store={store} ready={false} />);
    await frames();
    height = 2000;
    view.rerender(<Fixture store={store} ready />);
    resize();
    await frames();
    expect(view.getByTestId("viewport").scrollTop).toBe(1700);
  });

  it("waits for a partial transcript to grow enough to restore the reader", async () => {
    height = 300;
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 500, atBottom: false } });
    const view = render(<Fixture store={store} />);
    await frames();
    height = 2000;
    resize();
    await frames();
    expect(view.getByTestId("viewport").scrollTop).toBe(500);
  });

  it("lets the reader take over while a partial transcript is restoring", async () => {
    height = 600;
    const store = createChatViewStore();
    store.patch("a", { scroll: { top: 1000, atBottom: false } });
    const view = render(<Fixture store={store} />);
    const node = view.getByTestId("viewport");
    await frames();
    fireEvent.wheel(node);
    node.scrollTop = 100;
    fireEvent.scroll(node);
    height = 2000;
    resize();
    await frames();
    expect(node.scrollTop).toBe(100);
  });
});
