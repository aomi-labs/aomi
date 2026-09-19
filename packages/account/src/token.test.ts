import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Mint + session resolution are exercised elsewhere; here we isolate the route's
// own logic (gate on a session, the response shape, 500 vs 401 on mint failure).
vi.mock("./bearer", () => ({ mintAccountBearer: vi.fn() }));

import { mintAccountBearer } from "./bearer";
import { createBearerTokenRoute } from "./token";

const mintMock = vi.mocked(mintAccountBearer);

const fakeRequest = new NextRequest(
  "https://portal.aomi.dev/v1/account/bearer",
);

describe("createBearerTokenRoute", () => {
  it("401s when no session is present", async () => {
    const resolveCanonicalUserId = vi.fn(async () => null);
    const GET = createBearerTokenRoute({ resolveCanonicalUserId });

    const response = await GET(fakeRequest);

    expect(response.status).toBe(401);
    expect(resolveCanonicalUserId).toHaveBeenCalledWith(fakeRequest);
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("mints a bearer for the sessioned canonical user", async () => {
    const resolveCanonicalUserId = vi.fn(async () => "user-123");
    mintMock.mockResolvedValue({ bearer: "BEARER", expiresAt: 1_000 });
    const GET = createBearerTokenRoute({ resolveCanonicalUserId });

    const response = await GET(fakeRequest);

    expect(mintMock).toHaveBeenCalledWith("user-123");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      bearer: "BEARER",
      expires_at: 1_000,
    });
  });

  it("500s (not 401) when minting fails for a real session", async () => {
    const resolveCanonicalUserId = vi.fn(async () => "user-789");
    const failure = new Error("signing key missing");
    const observeFailure = vi.fn();
    mintMock.mockRejectedValue(failure);
    const GET = createBearerTokenRoute({
      resolveCanonicalUserId,
      observeFailure,
    });

    const response = await GET(fakeRequest);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "signing key missing",
    });
    expect(observeFailure).toHaveBeenCalledWith({
      kind: "bearer_mint",
      error: failure,
      method: "GET",
      pathname: "/v1/account/bearer",
      responseStatus: 500,
    });
  });

  it("does not let an observer failure replace the mint response", async () => {
    mintMock.mockRejectedValue(new Error("signing key missing"));
    const GET = createBearerTokenRoute({
      resolveCanonicalUserId: async () => "user-789",
      observeFailure: () => {
        throw new Error("telemetry unavailable");
      },
    });

    const response = await GET(fakeRequest);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "signing key missing",
    });
  });
});
