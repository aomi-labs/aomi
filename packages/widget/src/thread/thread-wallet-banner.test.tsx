import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WalletRow } from "@/wallet/composer/wallet-state";
import {
  ThreadWalletBanner,
  threadWalletMismatch,
} from "./thread-wallet-banner";

const runtime = vi.hoisted(() => ({
  value: null as null | {
    activeWallet?: Record<string, string>;
    setThreadWallet?: (id: string) => Promise<void>;
  },
}));
const kit = vi.hoisted(() => ({ wallets: [] as unknown[] }));
vi.mock("@aomi-labs/react", () => ({
  useOptionalAomiRuntime: () => runtime.value,
}));
vi.mock("@/wallet/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/wallet/context")>()),
  useAomiWalletKit: () => kit,
}));

const row = (overrides: Partial<WalletRow>): WalletRow =>
  ({
    key: "evm:0x1",
    family: "evm",
    address: "0x1",
    kind: "external",
    state: "ready",
    linked: true,
    connected: true,
    operating: false,
    actions: [],
    ...overrides,
  }) as WalletRow;
const rabby = row({
  key: "evm:0xda65",
  address: "0xda65",
  linkedWalletId: "4",
  brand: "Rabby",
  operating: true,
  active: true,
});
const agent = row({
  key: "evm:0x7a3f",
  address: "0x7a3f",
  kind: "agent",
  linkedWalletId: "12",
  connected: false,
});

describe("thread wallet banner", () => {
  it("finds a chat wallet that is not this device's pick", () => {
    expect(threadWalletMismatch({ evm: "w_12" }, [rabby, agent])).toEqual({
      family: "evm",
      active: "w_12",
      pick: "w_4",
    });
    expect(threadWalletMismatch({ evm: "w_4" }, [rabby, agent])).toBeNull();
    expect(threadWalletMismatch(undefined, [rabby])).toBeNull();
    expect(threadWalletMismatch({ svm: "w_9" }, [rabby])).toBeNull();
  });

  it("names the chat's wallet and switches the chat to this device's pick", async () => {
    const setThreadWallet = vi.fn(async () => undefined);
    runtime.value = { activeWallet: { evm: "w_12" }, setThreadWallet };
    kit.wallets = [rabby, agent];
    render(<ThreadWalletBanner />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This chat uses Agent wallet · Switch",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Switch this chat to Rabby" }),
      );
    });
    expect(setThreadWallet).toHaveBeenCalledWith("w_4");
  });

  it("explains a refused switch", async () => {
    runtime.value = {
      activeWallet: { evm: "w_12" },
      setThreadWallet: vi.fn(async () => {
        throw Object.assign(new Error("x"), { code: "wallet_switch_pending" });
      }),
    };
    kit.wallets = [rabby, agent];
    render(<ThreadWalletBanner />);
    const button = await screen.findByRole("button", {
      name: /Switch this chat/,
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finish or cancel this chat’s pending transaction first.",
    );
  });

  it("stays hidden when the chat uses this device's pick", () => {
    runtime.value = { activeWallet: { evm: "w_4" }, setThreadWallet: vi.fn() };
    kit.wallets = [rabby, agent];
    const { container } = render(<ThreadWalletBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
