// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimOwner: vi.fn(),
  issueSession: vi.fn(),
  linkIdentity: vi.fn(),
  verifyCredential: vi.fn(),
  verifyTelegram: vi.fn(),
}));

vi.mock("@aomi-labs/account/account", () => ({
  claimTelegramSessionOwner: mocks.claimOwner,
  linkVerifiedProviderIdentityForUser: mocks.linkIdentity,
}));

vi.mock("@aomi-labs/account/telegram", () => ({
  verifyTelegramInitData: mocks.verifyTelegram,
}));

vi.mock("@aomi-labs/account/widget-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aomi-labs/account/widget-auth")>();
  return {
    ...actual,
    issueWidgetSession: mocks.issueSession,
    requireWidgetOrigin: () => "https://telegram-mini.aomi.dev",
  };
});

vi.mock("@portal/server/widget-auth/exchange", () => ({
  verifyWidgetProviderCredential: mocks.verifyCredential,
}));

vi.mock("@portal/server/widget-auth/rate-limit", () => ({
  widgetAuthRateLimit: () => null,
}));

vi.mock("@portal/server/bff/failures", () => ({
  portalFailures: {
    handle: (input: { response: { error: string; status: number } }) => ({
      response: Response.json(
        { error: input.response.error },
        { status: input.response.status },
      ),
    }),
  },
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("https://portal.aomi.dev/api/auth/widget/telegram/exchange", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://telegram-mini.aomi.dev",
    },
    body: JSON.stringify(body),
  });
}

const DM_THREAD_ID = "0b9c1f2e-4d3a-4c5b-8e7f-1a2b3c4d5e6f";

describe("Telegram Para exchange", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.verifyTelegram.mockReturnValue({
      ok: true,
      launch: { botId: "123", telegramUserId: "456" },
    });
    mocks.claimOwner.mockResolvedValue("canonical-user");
    mocks.verifyCredential.mockResolvedValue({
      descriptor: {
        id: "para",
        policy: { subjectIsEnvironmentGlobal: true },
      },
      identity: {
        provider: "para",
        issuerEnvironment: "beta",
        tenantId: "para",
        subject: "para-user",
        walletAttestations: [],
      },
    });
    mocks.linkIdentity.mockResolvedValue({
      status: "linked",
      identity: { id: "provider-identity" },
      user: { id: "canonical-user" },
    });
    mocks.issueSession.mockResolvedValue({
      token: "widget-token",
      tokenType: "Bearer",
      expiresAt: 1_800_000_000,
      userId: "canonical-user",
    });
  });

  it("claims the Telegram session and issues a canonical Para bearer", async () => {
    const response = await POST(
      request({
        bot_id: "123",
        init_data: "signed-init-data",
        session_id: DM_THREAD_ID,
        credential: { provider: "para", provider_token: "credential" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access_token: "widget-token",
      user: { id: "canonical-user" },
    });
    expect(mocks.claimOwner).toHaveBeenCalledWith({
      sessionId: DM_THREAD_ID,
      telegramUserId: "456",
    });
    expect(mocks.issueSession).toHaveBeenCalledWith({
      userId: "canonical-user",
      origin: "https://telegram-mini.aomi.dev",
      authMethod: "telegram_para",
      providerIdentityId: "provider-identity",
    });
  });

  it("rejects a session already owned by another account", async () => {
    mocks.claimOwner.mockResolvedValue(null);

    const response = await POST(
      request({
        bot_id: "123",
        init_data: "signed-init-data",
        session_id: DM_THREAD_ID,
        credential: { provider: "para", provider_token: "credential" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "telegram_session_mismatch",
    });
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it("refuses to claim a thread whose id is not a private conversation", async () => {
    // `telegram:group:<chat>` is shared by every member and guessable, so a
    // valid launch must not be able to bind it to the caller's account.
    const response = await POST(
      request({
        bot_id: "123",
        init_data: "signed-init-data",
        session_id: "telegram:group:-1001234567890",
        credential: { provider: "para", provider_token: "credential" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "unsupported_session",
    });
    expect(mocks.claimOwner).not.toHaveBeenCalled();
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });
});
