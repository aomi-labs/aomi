import { describe, expect, it, vi } from "vitest";
const createSession = vi.hoisted(() => vi.fn());
vi.mock("@aomi-labs/account/better-auth", () => ({
  auth: { $context: Promise.resolve({ internalAdapter: { createSession } }) },
}));
import { createCliSession } from "./cli-session";
describe("independent CLI session", () => {
  it("asks for a one-day session without exporting or updating a browser token", async () => {
    const expiresAt = new Date(Date.now() + 86400000);
    createSession.mockResolvedValue({
      token: "independent-cli-token",
      expiresAt,
    });
    expect(await createCliSession("ba-user")).toEqual({
      sessionToken: "independent-cli-token",
      expiresAt,
    });
    expect(createSession).toHaveBeenCalledWith("ba-user", true);
  });
});
