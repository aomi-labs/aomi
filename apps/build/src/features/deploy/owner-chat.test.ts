import { describe, expect, it, vi } from "vitest";
import { ownerChatUrl } from "./owner-chat";

const CHAT = "https://chat.aomi.dev?app=demo&application_id=42&lock_app=1";

describe("ownerChatUrl", () => {
  it("hands a private app's claim to Chat in the fragment", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ claim: "aomi-claim-abc", expiresAt: 1 }),
    );
    await expect(ownerChatUrl(CHAT, 42, fetchImpl)).resolves.toBe(
      `${CHAT}#owner_claim=aomi-claim-abc`,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/bff/deployments/owner-claim",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ applicationId: 42 }),
      }),
    );
  });

  it("keeps the plain link for public apps and failures", async () => {
    const publicApp = vi.fn(async () => Response.json({ public: true }));
    await expect(ownerChatUrl(CHAT, 42, publicApp)).resolves.toBe(CHAT);
    const failed = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(ownerChatUrl(CHAT, 42, failed)).resolves.toBe(CHAT);
    const thrown = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(ownerChatUrl(CHAT, 42, thrown)).resolves.toBe(CHAT);
  });

  it("does not ask for a claim without an application id", async () => {
    const fetchImpl = vi.fn();
    await expect(ownerChatUrl(CHAT, null, fetchImpl)).resolves.toBe(CHAT);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
