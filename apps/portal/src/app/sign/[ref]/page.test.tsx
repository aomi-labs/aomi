import { describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
);
vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./sign-commit-client", () => ({
  SignCommitClient: ({ commitRef }: { commitRef: string }) => commitRef,
}));

import SignPage from "./page";

const params = Promise.resolve({ ref: "cmt_1" });

describe("/sign/:ref", () => {
  it.each([
    ["signed out", null],
    ["a guest", { user: { id: "guest", isAnonymous: true } }],
  ])("sends %s to login and back to the same page", async (_, session) => {
    getSession.mockResolvedValueOnce(session);
    await expect(SignPage({ params })).rejects.toThrow(
      "redirect:/?return_to=%2Fsign%2Fcmt_1",
    );
  });

  it("renders the review host for a signed-in account", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "user" } });
    const page = await SignPage({ params });
    expect(page.props).toEqual({ commitRef: "cmt_1" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
