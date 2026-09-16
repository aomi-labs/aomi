import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, forwardRef, useImperativeHandle } from "react";

import { ExtUserProvider, UserState, useUser } from "../ext-user-context";

type Handle = ReturnType<typeof useUser>;

const Harness = forwardRef<Handle>((_, ref) => {
  const api = useUser();
  useImperativeHandle(ref, () => api, [api]);
  return null;
});
Harness.displayName = "Harness";

afterEach(() => {
  cleanup();
});

function renderHarness() {
  const ref = createRef<Handle>();
  render(
    <ExtUserProvider>
      <Harness ref={ref} />
    </ExtUserProvider>,
  );
  return ref;
}

describe("ExtUserProvider.setUser", () => {
  it("wipes wallet identity and rejects runtime pending state on disconnect", () => {
    const ref = renderHarness();

    act(() => {
      ref.current!.setUser({
        connection: {
          is_connected: true,
          provider: "baseAccount",
          auth_method: "wagmi",
        },
        evm: {
          address: "0x1111111111111111111111111111111111111111",
          chain_id: 8453,
          ens_name: "alice.eth",
        },
        svm: { address: "Bv9..." },
      });
    });

    act(() => {
      ref.current!.setUser({ connection: { is_connected: false } });
    });

    const u = ref.current!.user;
    expect(UserState.isConnected(u)).toBe(false);
    expect(u.evm).toEqual({ chain_id: 8453 });
    expect(u.svm).toBeUndefined();
    expect(u).not.toHaveProperty("pending");
    expect(UserState.provider(u)).toBeUndefined();
    expect(UserState.authMethod(u)).toBeUndefined();
  });

  it("clears address-scoped fields and rejects pending state during an address transition", () => {
    const ref = renderHarness();

    act(() => {
      ref.current!.setUser({
        connection: { is_connected: true, provider: "para" },
        evm: {
          address: "0x1111111111111111111111111111111111111111",
          chain_id: 8453,
          ens_name: "alice.eth",
        },
      });
    });

    act(() => {
      ref.current!.setUser({
        evm: { address: "0x4444444444444444444444444444444444444444" },
      });
    });

    const u = ref.current!.user;
    expect(UserState.address(u)).toBe(
      "0x4444444444444444444444444444444444444444",
    );
    // Identity-static fields persist across the in-place switch.
    expect(UserState.provider(u)).toBe("para");
    expect(UserState.chainId(u)).toBe(8453);
    // ens belonged to the prior address and is cleared on the switch.
    expect(UserState.ensName(u)).toBeUndefined();
    expect(u).not.toHaveProperty("pending");
  });

  it("preserves identity fields when the same address re-sets (case-insensitive)", () => {
    const ref = renderHarness();

    act(() => {
      ref.current!.setUser({
        connection: { is_connected: true, provider: "para" },
        evm: {
          address: "0x1111111111111111111111111111111111111111",
          chain_id: 8453,
        },
      });
    });

    act(() => {
      ref.current!.setUser({
        evm: {
          address:
            "0x1111111111111111111111111111111111111111".toUpperCase(),
        },
      });
    });

    const u = ref.current!.user;
    expect(UserState.chainId(u)).toBe(8453);
    expect(UserState.provider(u)).toBe("para");
  });
});
