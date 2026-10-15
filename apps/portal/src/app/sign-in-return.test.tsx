import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeSignReturn, signLoginRedirect } from "@/lib/sign-return";

const useSession = vi.hoisted(() => vi.fn());
const kit = vi.hoisted(() => ({
  accountUser: undefined as { id: string } | undefined,
  accountGuest: undefined as boolean | undefined,
}));
vi.mock("@aomi-labs/widget/browser-auth", () => ({
  authClient: { useSession },
}));
vi.mock("@aomi-labs/widget/host-composition", () => ({
  useAomiWalletKit: () => kit,
}));

import { SignInReturn } from "./sign-in-return";

describe("returning to a sign link after login", () => {
  const replace = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    useSession.mockReset().mockReturnValue({ data: null });
    kit.accountUser = undefined;
    kit.accountGuest = undefined;
    replace.mockReset();
    vi.stubGlobal("location", {
      ...window.location,
      search: "",
      replace,
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("only accepts same-origin sign pages", () => {
    expect(signLoginRedirect("cmt_1")).toBe("/?return_to=%2Fsign%2Fcmt_1");
    expect(safeSignReturn("/sign/cmt_1")).toBe("/sign/cmt_1");
    for (const target of [
      "https://evil.example/sign/x",
      "//evil.example/sign/x",
      "/sign/x/../../settings",
      "/settings",
    ])
      expect(safeSignReturn(target)).toBeNull();
  });

  it("waits for a real sign-in, then returns once", async () => {
    window.location.search = "?return_to=%2Fsign%2Fcmt_1";
    useSession.mockReturnValue({
      data: { user: { id: "guest", isAnonymous: true } },
    });
    const view = render(<SignInReturn />);
    await waitFor(() => expect(useSession).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();

    useSession.mockReturnValue({ data: { user: { id: "user" } } });
    view.rerender(<SignInReturn />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign/cmt_1"));
    expect(sessionStorage.getItem("aomi.sign.return")).toBeNull();
  });

  it("ignores an unsafe return target", async () => {
    window.location.search = "?return_to=https%3A%2F%2Fevil.example";
    useSession.mockReturnValue({ data: { user: { id: "user" } } });
    render(<SignInReturn />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useSession).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
