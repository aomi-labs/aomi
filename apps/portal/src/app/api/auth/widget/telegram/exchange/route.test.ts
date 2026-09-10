// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimOwner: vi.fn(),
  issueSession: vi.fn(),
  linkIdentity: vi.fn(),
  resolveWallets: vi.fn(),
  verifyCredential: vi.fn(),
  verifyTelegram: vi.fn(),
}));

vi.mock("@aomi-labs/account/account", () => ({
  claimTelegramSessionOwner: mocks.claimOwner,
  linkVerifiedProviderIdentityForUser: mocks.linkIdentity,
  resolveAttestedProviderWallets: mocks.resolveWallets,
  // Same dedupe-by-address rule as the real helper; the module is mocked
  // wholesale to keep the Postgres pool out of this suite.
  mergeProviderWalletAttestations: (
    primary: { family: string; address: string }[],
    fallback: { family: string; address: string }[],
  ) => {
    const seen = new Set<string>();
    return [...primary, ...fallback].filter((wallet) => {
      const key = `${wallet.family}:${wallet.address.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  IdentityConflictError: class IdentityConflictError extends Error {},
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

// The route runs the real `requireAttestedProviderWallets`, so the mapping from
// a provider-API answer to a route failure code is under test; only the
// credential verification and the provider lookup underneath it are mocked.
vi.mock("@portal/server/widget-auth/exchange", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@portal/server/widget-auth/exchange")
    >();
  return { ...actual, verifyWidgetProviderCredential: mocks.verifyCredential };
});

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
  return new Request(
    "https://portal.aomi.dev/api/auth/widget/telegram/exchange",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://telegram-mini.aomi.dev",
      },
      body: JSON.stringify(body),
    },
  );
}

const DM_THREAD_ID = "0b9c1f2e-4d3a-4c5b-8e7f-1a2b3c4d5e6f";

const EVM_WALLET = {
  provider: "para",
  providerWalletId: "para-evm",
  family: "evm",
  address: "0x1111111111111111111111111111111111111111",
  chainScope: null,
};
const TOKEN_WALLET = {
  provider: "para",
  providerWalletId: "para-token-evm",
  family: "evm",
  address: "0x3333333333333333333333333333333333333333",
  chainScope: null,
};
const SVM_WALLET = {
  provider: "para",
  providerWalletId: "para-svm",
  family: "svm",
  address: "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL",
  chainScope: null,
};

function exchange(overrides: Record<string, unknown> = {}): Request {
  return request({
    bot_id: "123",
    init_data: "signed-init-data",
    session_id: DM_THREAD_ID,
    credential: { provider: "para", provider_token: "credential" },
    ...overrides,
  });
}

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
    mocks.resolveWallets.mockResolvedValue({
      status: "attested",
      wallets: [EVM_WALLET, SVM_WALLET],
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

  it("accepts Privy and stamps the session with the provider that logged in", async () => {
    // Privy is what the portal runs on, and unlike Para its wallet API is
    // keyed by the verified token subject, so the hosted wallet can be
    // attested server-side without leaning on the token's own claim.
    mocks.verifyCredential.mockResolvedValue({
      descriptor: {
        id: "privy",
        policy: { subjectIsEnvironmentGlobal: false },
      },
      identity: {
        provider: "privy",
        issuerEnvironment: "privy:prod",
        tenantId: "privy-app",
        subject: "did:privy:alice",
        walletAttestations: [],
      },
    });

    const response = await POST(exchange());

    expect(response.status).toBe(200);
    expect(mocks.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ authMethod: "telegram_privy" }),
    );
  });

  it("refuses a provider the Telegram flow does not support", async () => {
    mocks.verifyCredential.mockResolvedValue({
      descriptor: { id: "base", policy: { subjectIsEnvironmentGlobal: false } },
      identity: {
        provider: "base",
        issuerEnvironment: "base",
        tenantId: "base",
        subject: "base-user",
        walletAttestations: [],
      },
    });

    const response = await POST(exchange());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "provider_not_enabled",
    });
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
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
  it("merges the provider API answer with the token's signed attestation", async () => {
    mocks.verifyCredential.mockResolvedValue({
      descriptor: { id: "para", policy: { subjectIsEnvironmentGlobal: true } },
      identity: {
        provider: "para",
        issuerEnvironment: "beta",
        tenantId: "para",
        subject: "para-user",
        email: { value: "user@example.com", verified: true },
        loginIdentifier: { type: "telegram", value: "1234567890" },
        walletAttestations: [TOKEN_WALLET],
      },
    });

    const response = await POST(exchange());

    expect(response.status).toBe(200);
    expect(mocks.resolveWallets).toHaveBeenCalledWith({
      provider: "para",
      subject: "para-user",
      email: "user@example.com",
      loginIdentifier: { type: "telegram", value: "1234567890" },
    });
    expect(mocks.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "canonical-user",
        wallets: [EVM_WALLET, SVM_WALLET, TOKEN_WALLET],
      }),
    );
  });

  it("refuses the exchange when neither source knows of an embedded wallet", async () => {
    // The default credential mock carries no token attestation either.
    mocks.resolveWallets.mockResolvedValue({ status: "attested", wallets: [] });

    const response = await POST(exchange());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "provider_hosted_wallet_missing",
    });
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it("links on the token attestation alone when the Para API cannot answer", async () => {
    // Para's wallet list is indexed by pregen login handle and returns nothing
    // for an SDK-created wallet, so neither an empty answer nor an outage may
    // veto the token's own signed attestation.
    mocks.verifyCredential.mockResolvedValue({
      descriptor: { id: "para", policy: { subjectIsEnvironmentGlobal: true } },
      identity: {
        provider: "para",
        issuerEnvironment: "beta",
        tenantId: "para",
        subject: "para-user",
        walletAttestations: [TOKEN_WALLET],
      },
    });

    for (const resolution of [
      { status: "unavailable", error: new Error("para down") },
      { status: "unconfigured" },
      { status: "attested", wallets: [] },
    ]) {
      mocks.linkIdentity.mockClear();
      mocks.resolveWallets.mockResolvedValue(resolution);

      const response = await POST(exchange());

      expect(response.status).toBe(200);
      expect(mocks.linkIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ wallets: [TOKEN_WALLET] }),
      );
    }
  });

  it("fails closed when a wallet already belongs to another canonical user", async () => {
    mocks.linkIdentity.mockResolvedValue({
      status: "conflict",
      reason: "already_linked_to_another_account",
      signalType: "wallet",
    });

    const response = await POST(exchange());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "conflict",
      reason: "already_linked_to_another_account",
      signalType: "wallet",
      error: "already_linked_to_another_account",
    });
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it("tops up a missing wallet on a retry with the identity already linked", async () => {
    // The identity link is idempotent, so a user who linked Para before this
    // route synced wallets gets the wallet on the next Open Para — no manual
    // unlink, no new Telegram session.
    await POST(exchange());
    const response = await POST(exchange());

    expect(response.status).toBe(200);
    expect(mocks.linkIdentity).toHaveBeenCalledTimes(2);
    for (const call of mocks.linkIdentity.mock.calls) {
      expect(call[0]).toMatchObject({ wallets: [EVM_WALLET, SVM_WALLET] });
    }
  });
});
