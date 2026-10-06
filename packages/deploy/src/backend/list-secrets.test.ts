// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { BackendClient } from "../src/backend";

function client() {
  return new BackendClient({
    aomi: {
      backendUrl: "https://staging-api.example.com/",
      activationToken: "act-token",
    },
  });
}

describe("BackendClient.listSecrets", () => {
  it("maps by_app handles and never leaks values", async () => {
    const c = client();
    vi.spyOn(c as unknown as { get: () => unknown }, "get").mockResolvedValue({
      by_app: { demo: ["$SECRET:APP:demo::API_KEY"] },
    });
    const result = await c.listSecrets({ clientId: "abc" });
    expect(result.byApp).toEqual({ demo: ["$SECRET:APP:demo::API_KEY"] });
  });

  it("defaults to empty byApp when backend omits it", async () => {
    const c = client();
    vi.spyOn(c as unknown as { get: () => unknown }, "get").mockResolvedValue(
      {},
    );
    const result = await c.listSecrets();
    expect(result.byApp).toEqual({});
  });
});

describe("BackendClient application-scoped service secrets", () => {
  it("passes only application_id when listing app secrets", async () => {
    const c = client();
    const get = vi
      .spyOn(c as unknown as { get: () => unknown }, "get")
      .mockResolvedValue({
        by_app: { demo: ["API_KEY"] },
      });

    const result = await c.listAppSecrets({
      applicationId: 42,
    });

    expect(result.byApp).toEqual({ demo: ["API_KEY"] });
    expect(get).toHaveBeenCalledWith(
      "/api/_internal/secrets?application_id=42",
      "list_secrets",
      "act-token",
    );
  });

  it("tags writes and deletes with application_id", async () => {
    const c = client();
    const post = vi
      .spyOn(c as unknown as { post: () => unknown }, "post")
      .mockResolvedValue({ handles: { API_KEY: "$SECRET:APP:demo::API_KEY" } });
    const del = vi
      .spyOn(c as unknown as { del: () => unknown }, "del")
      .mockResolvedValue({ removed: true });

    await c.ingestSecrets({
      app: "demo",
      applicationId: 42,
      secrets: { API_KEY: "secret" },
    });
    const removed = await c.removeAppSecret({
      applicationId: 42,
      name: "API_KEY",
    });

    expect(removed).toBe(true);
    expect(post).toHaveBeenCalledWith(
      "/api/_internal/secrets",
      {
        app: "demo",
        application_id: 42,
        secrets: { API_KEY: "secret" },
      },
      "ingest_secrets",
      "act-token",
    );
    expect(del).toHaveBeenCalledWith(
      "/api/_internal/secrets",
      "ingest_secrets",
      "act-token",
      {
        application_id: 42,
        name: "API_KEY",
      },
    );
  });
});
