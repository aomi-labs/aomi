import { describe, expect, it, vi } from "vitest";

import { createCliSession } from "./cli-session";

describe("independent CLI session", () => {
  it("asks for a one-day session without exporting or updating a browser token", async () => {
    const expiresAt = new Date(Date.now() + 86400000);
    const createSession = vi.fn().mockResolvedValue({ token: "independent-cli-token", expiresAt });
    const auth = { $context: Promise.resolve({ internalAdapter: { createSession } }) } as unknown as Parameters<
      typeof createCliSession
    >[0];
    expect(await createCliSession(auth, "ba-user")).toEqual({ sessionToken: "independent-cli-token", expiresAt });
    expect(createSession).toHaveBeenCalledWith("ba-user", true);
  });
});
