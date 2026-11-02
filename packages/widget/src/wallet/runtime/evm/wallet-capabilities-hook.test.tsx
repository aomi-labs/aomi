import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("wagmi", () => ({
  useConfig: () => ({}),
  useConnections: () => [],
  useWalletClient: () => ({}),
}));
vi.mock("wagmi/actions", () => ({
  getWalletClient: vi.fn(),
  getConnectorClient: vi.fn(async () => ({ request: fixture.request })),
  sendCalls: vi.fn(async () => ({ id: "0xid" })),
  waitForCallsStatus: vi.fn(async () => {
    throw Object.assign(new Error("User rejected"), { code: 4001 });
  }),
}));

import { markNoEip5792 } from "./capability-probe";
import { useSendCallsSyncExecutor, useWalletCapabilities } from "./wagmi-hooks";

const account = "0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0" as const;
const connector = {
  id: "io.metamask",
  name: "MetaMask",
  type: "injected",
  uid: "mm-1",
} as never;
const ready = { "0x2105": { atomic: { status: "ready" } } };

function mount(uid = "mm-1") {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useWalletCapabilities({
        account,
        connector: { ...(connector as object), uid } as never,
        chainId: 8453,
        chainIds: [8453],
      }),
    { wrapper },
  );
}

describe("useWalletCapabilities", () => {
  beforeEach(() => fixture.request.mockReset());

  it("probes the connector provider and reports ready as batchable", async () => {
    fixture.request.mockResolvedValue(ready);
    const { result } = mount("mm-ok");
    await waitFor(() =>
      expect(result.current.capabilities?.["8453"]?.atomic?.status).toBe(
        "supported",
      ),
    );
    expect(fixture.request).toHaveBeenCalledWith({
      method: "wallet_getCapabilities",
      params: [account, ["0x2105"]],
    });
  });

  it("never re-probes a connector that answered -32601, other connectors still probe", async () => {
    fixture.request.mockResolvedValue(ready);
    markNoEip5792("no-5792");
    const none = mount("no-5792");
    expect(none.result.current.capabilities).toBeUndefined();
    expect(fixture.request).not.toHaveBeenCalled();
    const other = mount("other");
    await waitFor(() =>
      expect(other.result.current.capabilities).toBeDefined(),
    );
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
});

describe("useSendCallsSyncExecutor", () => {
  it("marks any failure after the wallet answered a call id as accepted", async () => {
    const send = renderHook(() => useSendCallsSyncExecutor()).result.current;
    const onAccepted = vi.fn();
    const error = await send({ calls: [], onAccepted } as never).catch(
      (e: unknown) => e,
    );
    expect(onAccepted).toHaveBeenCalledWith("0xid");
    expect(error).toMatchObject({ callsId: "0xid", cause: { code: 4001 } });
    expect(error).not.toHaveProperty("code");
  });
});
