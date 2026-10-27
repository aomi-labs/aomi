// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fakeManager } from "./testing";

describe("application-scoped service secrets", () => {
  it("passes only application_id when listing app secrets", async () => {
    const { client, sent } = fakeManager({ by_app: { demo: ["API_KEY"] } });

    const result = await client.listAppSecrets({ applicationId: 42 });

    expect(result.byApp).toEqual({ demo: ["API_KEY"] });
    expect(sent).toEqual([
      {
        method: "GET",
        url: "/api/_internal/secrets?application_id=42",
        body: undefined,
        headers: { Authorization: "Bearer service-token" },
      },
    ]);
  });

  it("defaults to an empty byApp when the manager omits it", async () => {
    const { client } = fakeManager({});
    await expect(client.listAppSecrets({ applicationId: 42 })).resolves.toEqual({ byApp: {} });
  });

  it("tags writes and deletes with application_id", async () => {
    const { client, sent } = fakeManager({ handles: { API_KEY: "$SECRET:APP:demo::API_KEY" } }, { removed: true });

    await client.ingestSecrets({ app: "demo", applicationId: 42, secrets: { API_KEY: "secret" } });
    const removed = await client.removeAppSecret({ applicationId: 42, name: "API_KEY" });

    expect(removed).toBe(true);
    expect(sent.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      {
        method: "POST",
        url: "/api/_internal/secrets",
        body: { application_id: 42, app: "demo", secrets: { API_KEY: "secret" } },
      },
      { method: "DELETE", url: "/api/_internal/secrets", body: { application_id: 42, name: "API_KEY" } },
    ]);
  });
});
