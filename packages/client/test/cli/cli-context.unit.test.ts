import { afterEach, describe, expect, it, vi } from "vitest";

import { createControlClient } from "../../src/cli/context";

describe("CLI control client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses an explicitly supplied scoped bearer for Pipeline", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ returned: 0, apps: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", request);

    await createControlClient({
      baseUrl: "https://api.example",
      accountBearer: "explicit-bearer",
      secrets: {},
    }).pipeline.apps.list();

    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer explicit-bearer");
  });
});
