import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
}));

vi.mock("@aomi-labs/account/better-auth", () => ({ auth: {} }));
vi.mock("@better-auth/oauth-provider", () => ({
  oauthProviderAuthServerMetadata: () => mocks.metadata,
}));
vi.mock("@portal/server/oauth/cors", () => ({
  publicDiscoveryResponse: (response: Response) => response,
}));

import { GET } from "./route";

describe("path-scoped OAuth authorization-server discovery", () => {
  it("serves metadata for the /api/auth issuer", async () => {
    mocks.metadata.mockResolvedValue(
      Response.json({ issuer: "https://chat.aomi.dev/api/auth" }),
    );
    const request = new Request(
      "https://chat.aomi.dev/.well-known/oauth-authorization-server/api/auth",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issuer: "https://chat.aomi.dev/api/auth",
    });
    expect(mocks.metadata).toHaveBeenCalledWith(request);
  });
});
