// @vitest-environment node
import { describe, expect, it } from "vitest";

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
});
