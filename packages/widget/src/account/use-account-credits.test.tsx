import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { Aomi } from "@aomi-labs/client";
import { DisplayCacheProvider } from "../../../react/src/query/display-cache";
import { useAccountCredits } from "./use-account-credits";

const sdk = vi.hoisted(() => ({ get: vi.fn() }));
const api = { account: { credits: sdk } } as unknown as Aomi;
vi.mock("../wallet/context", () => ({
  useAomiWalletKit: () => ({
    accountUser: { id: "account-a" },
    accountGuest: false,
  }),
}));

describe("shared account credit display read", () => {
  it("serves four surfaces from one request and keeps the data when Settings reopens", async () => {
    sdk.get.mockResolvedValue({ balance_microusd: 42 });
    function Surface() {
      const credits = useAccountCredits();
      return <span>{credits.data?.balance_microusd ?? "pending"}</span>;
    }
    const frame = (count: number) => (
      <DisplayCacheProvider
        backendUrl="/api"
        account={{ kind: "user", id: "account-a" }}
        persistence="none"
        aomi={api}
      >
        {Array.from({ length: count }, (_, index) => (
          <Surface key={index} />
        ))}
      </DisplayCacheProvider>
    );
    const view = render(frame(4));
    await waitFor(() => expect(screen.getAllByText("42")).toHaveLength(4));
    expect(sdk.get).toHaveBeenCalledOnce();
    expect(sdk.get).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    view.rerender(frame(1));
    view.rerender(frame(4));
    expect(screen.getAllByText("42")).toHaveLength(4);
    expect(sdk.get).toHaveBeenCalledOnce();
  });
});
