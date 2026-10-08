import { act, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  ThreadContextProvider,
  useThreadContext,
} from "../contexts/thread-context";
import { useThreadNavigation } from "./use-thread-navigation";

describe("host thread navigation", () => {
  it("restores externally selected ids and reports internal selection once", () => {
    const changed = vi.fn();
    let select!: (id: string) => void;
    function Navigation({ id }: { id?: string }) {
      useThreadNavigation(id, changed);
      const thread = useThreadContext();
      select = thread.setCurrentThreadId;
      return <span>{thread.currentThreadId}</span>;
    }
    const frame = (id?: string) => (
      <ThreadContextProvider initialThreadId="a">
        <Navigation id={id} />
      </ThreadContextProvider>
    );
    const view = render(frame("a"));
    view.rerender(frame("b"));
    expect(screen.getByText("b")).toBeVisible();
    expect(changed).not.toHaveBeenCalled();
    act(() => select("c"));
    expect(changed).toHaveBeenCalledExactlyOnceWith("c");
    view.rerender(frame("c"));
    expect(changed).toHaveBeenCalledOnce();
    view.rerender(frame("a"));
    expect(screen.getByText("a")).toBeVisible();
    expect(changed).toHaveBeenCalledOnce();
  });
});
