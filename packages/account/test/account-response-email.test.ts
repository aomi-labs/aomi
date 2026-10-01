// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { buildAccountResponse } from "../src/db/queries";
import type { DbAomiUser } from "../src/types";

const user: DbAomiUser = {
  id: "user-1",
  betterAuthUserId: null,
  displayName: "privy user",
  primaryEmail: null,
  avatarUrl: null,
  metadata: {},
  deactivatedAt: null,
  createdAt: new Date(1_000),
  updatedAt: new Date(1_000),
};

function identity(input: {
  id: string;
  provider?: string;
  email?: string;
  verifiedAt?: number | null;
  createdAt?: number;
}) {
  return {
    id: input.id,
    user_id: user.id,
    provider: input.provider ?? "email",
    issuer_environment: "aomi",
    tenant_id: "global",
    subject: input.email ?? input.id,
    provider_metadata: input.email ? { email: input.email } : {},
    verified_at: input.verifiedAt ?? null,
    created_at: input.createdAt ?? 1,
    updated_at: 2,
  };
}

async function responseFor(
  identities: ReturnType<typeof identity>[],
  profile: DbAomiUser = user,
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from auth_providers")) return { rows: identities };
    if (sql.includes("from public_keys")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const response = await buildAccountResponse({
    user: profile,
    session: { carrier: "widget", expiresAt: 2_000, authMethod: "privy" },
    db: { query } as never,
  });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.every(([sql]) => sql.trimStart().startsWith("select"))).toBe(true);
  return response;
}

describe("account response email", () => {
  it("exposes the oldest verified email identity without changing the stored profile", async () => {
    const response = await responseFor([
      identity({ id: "unverified", email: "unverified@example.test" }),
      identity({
        id: "provider",
        provider: "privy",
        email: "untrusted@example.test",
        verifiedAt: 1,
      }),
      identity({
        id: "newer",
        email: "newer@example.test",
        verifiedAt: 1,
        createdAt: 5,
      }),
      identity({
        id: "older",
        email: "older@example.test",
        verifiedAt: 1,
        createdAt: 3,
      }),
    ]);

    expect(response.user).toMatchObject({
      displayName: "privy user",
      email: "older@example.test",
    });
    expect(user.primaryEmail).toBeNull();
  });

  it("preserves a custom name and an explicit primary email", async () => {
    const response = await responseFor(
      [identity({ id: "email", email: "linked@example.test", verifiedAt: 1 })],
      { ...user, displayName: "Ada", primaryEmail: "primary@example.test" },
    );

    expect(response.user).toMatchObject({
      displayName: "Ada",
      email: "primary@example.test",
    });
  });

  it("does not infer an email from an unverified identity", async () => {
    const response = await responseFor([
      identity({ id: "email", email: "unverified@example.test" }),
    ]);

    expect(response.user?.email).toBeUndefined();
  });
});
