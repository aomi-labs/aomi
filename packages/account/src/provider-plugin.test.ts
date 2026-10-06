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

vi.mock("../src/providers", () => providerMocks);
vi.mock("../src/service/provider-exchange", () => exchangeMocks);
vi.mock("../src/db/queries", () => ({
  buildAccountResponse: vi.fn(),
}));

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
});
