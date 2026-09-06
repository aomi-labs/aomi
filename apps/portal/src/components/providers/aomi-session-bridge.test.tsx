import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { seedAccountOverview } from "@portal/lib/account-overview";
import { useAomiSession } from "./aomi-session-bridge";

type AdapterState = {
  identity: { status: "anonymous" | "booting" | "connected" };
  accountStatus: "disabled" | "loading" | "ready" | "error";
  accountGuest?: boolean;
  accountUser?: { id: string };
  connect: ReturnType<typeof vi.fn>;
};

const adapterState = vi.hoisted(() => ({
  current: {
    identity: { status: "connected" },
    accountStatus: "ready",
    accountUser: undefined,
    connect: vi.fn(async () => undefined),
  } as AdapterState,
}));

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => adapterState.current,
}));

function SessionProbe() {
  const { status, retry } = useAomiSession();
  return (
    <button type="button" onClick={retry}>
      {status}
    </button>
  );
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useAomiSession lifecycle", () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    adapterState.current = {
      identity: { status: "connected" },
      accountStatus: "ready",
      accountUser: undefined,
      connect: vi.fn(async () => undefined),
    };
    await act(async () => {
      seedAccountOverview(null);
    });
  });

  it("does not let a never-settling provider block the account probe forever", async () => {
    vi.useFakeTimers();
    adapterState.current = {
      identity: { status: "booting" },
      accountStatus: "loading",
      accountUser: undefined,
      connect: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async () =>
      Response.json({ user: { user_id: "acct-a" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionProbe />);
    expect(screen.getByRole("button")).toHaveTextContent("establishing");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent("ready");
  });

  it("retries a transient 401 when exchange settles before its cookie", async () => {
    vi.useFakeTimers();
    adapterState.current = {
      identity: { status: "connected" },
      accountStatus: "loading",
      accountUser: undefined,
      connect: vi.fn(async () => undefined),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ user: { user_id: "acct-a" } }));
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<SessionProbe />);
    expect(fetchMock).not.toHaveBeenCalled();

    adapterState.current = {
      ...adapterState.current,
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    view.rerender(<SessionProbe />);
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toHaveTextContent("establishing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button")).toHaveTextContent("ready");
  });

  it("reports anonymous after the post-exchange 401 grace window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionProbe />);
    await flushEffects();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("button")).toHaveTextContent("anonymous");
  });

  it("treats the temporary Better Auth guest as signed out account chrome", async () => {
    adapterState.current = {
      identity: { status: "connected" },
      accountStatus: "ready",
      accountGuest: true,
      accountUser: undefined,
      connect: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionProbe />);
    await flushEffects();

    expect(screen.getByRole("button")).toHaveTextContent("anonymous");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restarts provider authentication when the user retries", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<SessionProbe />);

    fireEvent.click(screen.getByRole("button"));

    expect(adapterState.current.connect).toHaveBeenCalledTimes(1);
  });
});
