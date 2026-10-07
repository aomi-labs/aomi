// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  providerSessionUserSeed: vi.fn(() => ({
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice",
  })),
  verifyProviderCredential: vi.fn(async () => ({
    provider: "para",
    issuerEnvironment: "para:beta",
    tenantId: "project-a",
    walletAttestationProvider: "para",
    token: {
      subject: "para-user",
      expiresAt: 2_000_000_000,
      email: "alice@example.com",
      emailVerified: true,
      providerMetadata: {},
      walletAttestations: [],
    },
  })),
}));

const exchangeMocks = vi.hoisted(() => ({
  signInWithVerifiedProviderCredential: vi.fn(async () => ({
    status: "conflict",
    reason: "already_linked_to_another_account",
    signalType: "wallet",
  })),
}));

const queryMocks = vi.hoisted(() => ({
  buildAccountResponse: vi.fn(async ({ user }) => ({
    user,
    linkedAccounts: [],
    wallets: [],
    session: null,
  })),
}));

const cookieMocks = vi.hoisted(() => ({
  setSessionCookie: vi.fn(),
}));

vi.mock("../src/providers", () => providerMocks);
vi.mock("../src/service/provider-exchange", () => exchangeMocks);
vi.mock("../src/db/queries", () => queryMocks);
vi.mock("better-auth/cookies", () => cookieMocks);

import { aomiProviderAuthPlugin } from "../src/better-auth/provider-plugin";
import { setAccountDiagnosticObserver } from "../src/observability";

describe("provider auth plugin", () => {
  afterEach(() => setAccountDiagnosticObserver(undefined));

  it("does not create a session when verified signals conflict", async () => {
    const createSession = vi.fn();
    const diagnostic = vi.fn();
    setAccountDiagnosticObserver(diagnostic);
    const endpoint = aomiProviderAuthPlugin().endpoints
      ?.exchangeProviderToken as unknown as (ctx: unknown) => Promise<unknown>;

    await expect(
      endpoint({
        request: new Request(
          "https://chat.aomi.dev/api/auth/aomi/provider/exchange",
        ),
        body: {
          provider: "para",
          providerToken: "token",
        },
        context: {
          internalAdapter: {
            findUserByEmail: vi.fn(async () => ({
              user: {
                id: "ba-user-1",
                email: "alice@example.com",
                emailVerified: true,
                name: "Alice",
              },
            })),
            createUser: vi.fn(),
            createSession,
          },
        },
        json: vi.fn(),
      }),
    ).rejects.toMatchObject({
      body: expect.objectContaining({
        message: "already_linked_to_another_account",
        signalType: "wallet",
      }),
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith({
      kind: "provider.link_conflict",
      attributes: { provider: "para", signal_type: "wallet" },
      context: {
        routeFamily: "/api/auth/[...all]",
        operation: "account.provider_link",
        method: "POST",
      },
      response: {
        status: 409,
        error: "already_linked_to_another_account",
      },
    });
    expect(diagnostic.mock.calls[0]?.[0]?.attributes).not.toHaveProperty(
      "subject",
    );
    expect(diagnostic.mock.calls[0]?.[0]?.attributes).not.toHaveProperty(
      "better_auth_user_id",
    );
  });

  it.each(["para", "privy"] as const)(
    "does not reuse a real-email Better Auth carrier for %s sign-in",
    async (provider) => {
      providerMocks.verifyProviderCredential.mockResolvedValueOnce({
        provider,
        issuerEnvironment: `${provider}:test`,
        tenantId: "project-a",
        walletAttestationProvider: provider,
        token: {
          subject: `${provider}-user`,
          expiresAt: 2_000_000_000,
          email: "alice@example.com",
          emailVerified: true,
          providerMetadata: {},
          walletAttestations: [],
        },
      });
      exchangeMocks.signInWithVerifiedProviderCredential.mockImplementationOnce(
        async ({ betterAuthUserId }) =>
          betterAuthUserId === "ba-provider-carrier"
            ? {
                status: "linked",
                user: { id: "wallet-owner" },
                identity: { id: "para-identity" },
              }
            : {
                status: "conflict",
                reason: "already_linked_to_another_account",
                signalType: "wallet",
              },
      );
      const findUserByEmail = vi.fn(async (email: string) =>
        email === "alice@example.com"
          ? {
              user: {
                id: "ba-real-email-carrier",
                email,
                emailVerified: true,
                name: "Alice",
              },
            }
          : null,
      );
      const createUser = vi.fn(async ({ email }) => ({
        id: "ba-provider-carrier",
        email,
        emailVerified: false,
        name: "Alice",
      }));
      const createSession = vi.fn(async () => ({
        token: "session-token",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
      }));
      const json = vi.fn((value) => value);
      const endpoint = aomiProviderAuthPlugin().endpoints
        ?.exchangeProviderToken as unknown as (
        ctx: unknown,
      ) => Promise<unknown>;

      await expect(
        endpoint({
          request: new Request(
            "https://chat.aomi.dev/api/auth/aomi/provider/exchange",
          ),
          body: { provider, providerToken: "token" },
          context: {
            internalAdapter: {
              findUserByEmail,
              createUser,
              createSession,
            },
          },
          json,
        }),
      ).resolves.toMatchObject({ status: "linked" });

      expect(findUserByEmail).not.toHaveBeenCalledWith(
        "alice@example.com",
        expect.anything(),
      );
      expect(findUserByEmail).toHaveBeenCalledWith(
        expect.stringMatching(/^provider-[a-f0-9]{64}@accounts\.invalid$/),
        { includeAccounts: false },
      );
      expect(createUser).toHaveBeenCalledWith(
        {
          email: expect.stringMatching(
            /^provider-[a-f0-9]{64}@accounts\.invalid$/,
          ),
          emailVerified: false,
          name: "Alice",
        },
        { method: "aomi-provider" },
      );
      expect(
        exchangeMocks.signInWithVerifiedProviderCredential,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ betterAuthUserId: "ba-provider-carrier" }),
      );
      expect(createSession).toHaveBeenCalledWith("ba-provider-carrier");
    },
  );
});
