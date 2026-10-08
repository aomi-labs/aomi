import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAomiDisplayCache } from "@aomi-labs/react";
import {
  DisplayCacheProvider,
  type DisplayCache,
} from "../../../react/src/query/display-cache";
import { useAomiSession } from "./aomi-session-bridge";

const state = vi.hoisted(() => ({
  fetch: vi.fn(async () => Response.json({ user: { user_id: "account-a" } })),
}));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({
    identity: { status: "connected" },
    accountStatus: "ready",
    accountUser: { id: "account-a" },
    accountGuest: false,
  }),
}));
vi.mock("./transport", () => {
  const transport = { fetch: state.fetch, json: state.fetch };
  return { useShellTransport: () => transport };
});

function Gate() {
  const { status } = useAomiSession();
  return <span data-testid="gate">{status}</span>;
}

describe("runtime-owned Settings display probe", () => {
  it("reuses warm profile metadata on reopen and refreshes after invalidation", async () => {
    let cache!: DisplayCache;
    function Capture() {
      const current = useAomiDisplayCache();
      useEffect(() => {
        cache = current!;
      }, [current]);
      return null;
    }
    function Harness({ open }: { open: boolean }) {
      return (
        <DisplayCacheProvider
          backendUrl="https://backend.example"
          account={{ kind: "user", id: "account-a" }}
          persistence="none"
        >
          <Capture />
          {open && <Gate />}
        </DisplayCacheProvider>
      );
    }
    const view = render(<Harness open />);
    await waitFor(() =>
      expect(screen.getByTestId("gate")).toHaveTextContent("ready"),
    );
    expect(state.fetch).toHaveBeenCalledTimes(1);
    view.rerender(<Harness open={false} />);
    view.rerender(<Harness open />);
    expect(screen.getByTestId("gate")).toHaveTextContent("ready");
    await waitFor(() =>
      expect(screen.getByTestId("gate")).toHaveTextContent("ready"),
    );
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(cache.client.getQueryData(cache.key("profile"))).toEqual({
      user: { user_id: "account-a" },
    });
    view.rerender(<Harness open={false} />);
    await cache.client.invalidateQueries({
      queryKey: cache.key("profile"),
      exact: true,
    });
    view.rerender(<Harness open />);
    await waitFor(() =>
      expect(screen.getByTestId("gate")).toHaveTextContent("ready"),
    );
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});
