// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { OPTIONS, POST } from "./route";

const ORIGIN = "https://mini-app-staging.aomi.dev";

function callbackRequest(body: unknown): Request {
  return new Request(
    "https://chat-staging.aomi.dev/api/delegation/privy/callback",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Privy delegation callback", () => {
  it("answers the Mini App's JSON preflight with the allowed origin", () => {
    const response = OPTIONS(
      new Request(
        "https://chat-staging.aomi.dev/api/delegation/privy/callback",
        {
          method: "OPTIONS",
          headers: {
            origin: ORIGIN,
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type",
          },
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Content-Type",
    );
  });

  it("keeps CORS on the callback response after forwarding it upstream", async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: "connected" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      callbackRequest({
        state: "signed-state",
        access_token: "privy-access-token",
        user_id: "did:privy:alice",
        wallets: [],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
