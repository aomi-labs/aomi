// @vitest-environment node
import { describe, expect, expectTypeOf, it } from "vitest";

import { fakeManager } from "./testing";

describe("builder read rows", () => {
  it("reads the publisher, an agent and a package by name", async () => {
    const { client, sent } = fakeManager(
      { publisher: "arixoneth", agents: [{ id: "arixoneth/hoodit" }], packages: [] },
      { agent: { id: "arixoneth/hoodit", display_name: "Hoodit", status: "needs_rebuild" }, live: null },
      { package: { id: "arixoneth/trade" }, live: null, verified: true },
    );
    expect(await client.getPublisher()).toEqual({
      publisher: "arixoneth",
      agents: [{ id: "arixoneth/hoodit" }],
      packages: [],
    });
    expect(await client.getAgent({ name: "hoodit" })).toMatchObject({ live: null, channels: [] });
    expect(await client.getPackage({ name: "trade" })).toMatchObject({ verified: true, slots: [] });
    expect(sent.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /api/publishers/me",
      "GET /api/agents/hoodit",
      "GET /api/packages/trade",
    ]);
  });

  it("reads the excluded package selectors from a live agent config", async () => {
    const exclude = ["alice/trade", "tag:bridge"];
    const { client } = fakeManager({ live: { config: { exclude } } });
    const { live } = await client.getAgent({ name: "hoodit" });
    expectTypeOf(live!.config.exclude).toEqualTypeOf<string[]>();
    expect(live?.config.exclude).toEqual(exclude);
  });

  it("sets and clears a builder secret by package and slot", async () => {
    const { client, sent } = fakeManager({ slot: "GMGN_API_KEY", status: "set" }, { status: "missing" });
    expect(await client.setPackageSecret({ name: "trade", slot: "GMGN_API_KEY", value: "v" })).toEqual({
      slot: "GMGN_API_KEY",
      status: "set",
    });
    expect(await client.clearPackageSecret({ name: "trade", slot: "GMGN_API_KEY" })).toEqual({ status: "missing" });
    expect(sent.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["PUT", "/api/packages/trade/secrets/GMGN_API_KEY", { value: "v" }],
      ["DELETE", "/api/packages/trade/secrets/GMGN_API_KEY", undefined],
    ]);
    await expect(client.setPackageSecret({ name: "trade", slot: " ", value: "v" })).rejects.toThrow("slot is required");
  });

  it("issues, lists and revokes activation codes and removes one grant", async () => {
    const { client, sent } = fakeManager(
      { id: 4, package: "alice/trade", code: "1f3a-c0de", agent: null, created_at: "now" },
      { package: "alice/trade", codes: [{ id: 4, agent: null, created_at: "now", revoked_at: null, grants: [] }] },
      { revoked: 3 },
      { revoked: true },
    );
    expect(await client.issueCode({ name: "trade" })).toMatchObject({ id: 4, code: "1f3a-c0de" });
    expect((await client.listCodes({ name: "trade" })).codes).toHaveLength(1);
    expect(await client.revokeCode({ name: "trade", code: 4 })).toEqual({ revoked: 3 });
    expect(await client.removeGrant({ name: "trade", grant: 9 })).toEqual({ revoked: true });
    await client.issueCode({ name: "trade", agent: "alice/bot" });
    expect(sent.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["POST", "/api/packages/trade/codes", {}],
      ["GET", "/api/packages/trade/codes", undefined],
      ["DELETE", "/api/packages/trade/codes/4", undefined],
      ["DELETE", "/api/packages/trade/grants/9", undefined],
      ["POST", "/api/packages/trade/codes", { agent: "alice/bot" }],
    ]);
    await expect(client.revokeCode({ name: "trade", code: 0 })).rejects.toThrow("code must be a positive integer");
  });
});
