// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  issue: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@aomi-labs/account/account", () => ({
  findAomiUserForTelegram: mocks.findUser,
}));
vi.mock("@portal/server/widget-auth/telegram-custom-auth", () => ({
  issueTelegramCustomAuthJwt: mocks.issue,
  verifyTrustedTelegramLaunch: mocks.verify,
}));
vi.mock("@aomi-labs/account/widget-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/account/widget-auth")>()),
  requireWidgetOrigin: () => "https://mini-app-staging.aomi.dev",
}));
vi.mock("@portal/server/widget-auth/rate-limit", () => ({
  widgetAuthRateLimit: () => null,
}));
vi.mock("@portal/server/bff/failures", () => ({
  portalFailures: {
    handle: (input: { response: { error: string; status: number } }) => ({
      response: Response.json(input.response, { status: input.response.status }),
    }),
  },
}));

import { POST } from "./route";

function request(intent = "status"): Request {
  return new Request("https://chat-staging.aomi.dev/api/auth/widget/telegram/custom-auth", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://mini-app-staging.aomi.dev" },
    body: JSON.stringify({ bot_id: "8817783142", init_data: "telegram-proof", intent }),
  });
}

describe("Telegram Custom JWT bootstrap", () => {
  beforeEach(() => {
    mocks.findUser.mockReset();
    mocks.issue.mockReset();
    mocks.verify.mockReset().mockReturnValue({
      ok: true,
      launch: { botId: "8817783142", telegramUserId: "123", customSubject: "aomi:telegram:staging:123" },
    });
    mocks.issue.mockResolvedValue("short-custom-jwt");
  });

  it("does not create a Custom JWT for an unbound Telegram account", async () => {
    mocks.findUser.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "unbound",
      custom_subject: "aomi:telegram:staging:123",
    });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("does not issue a credential while only checking a known binding", async () => {
    mocks.findUser.mockResolvedValue("canonical-user");
    const response = await POST(request());
    await expect(response.json()).resolves.toEqual({
      status: "bound",
      custom_subject: "aomi:telegram:staging:123",
    });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("issues one for an explicit authentication of a known binding", async () => {
    mocks.findUser.mockResolvedValue("canonical-user");
    const response = await POST(request("authenticate"));
    await expect(response.json()).resolves.toEqual({
      status: "bound",
      custom_subject: "aomi:telegram:staging:123",
      custom_auth_jwt: "short-custom-jwt",
    });
    expect(mocks.issue).toHaveBeenCalledWith({ customSubject: "aomi:telegram:staging:123" });
  });

  it("requires an explicit existing-wallet link or new-wallet choice before issuing for an unbound account", async () => {
    mocks.findUser.mockResolvedValue(null);
    const response = await POST(request("link"));
    expect(response.status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledTimes(1);
  });
});
