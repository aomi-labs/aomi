// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createLaunchClient } from "./browser-client";

/** Capture the URL + body of every request the client makes. */
function recordingClient(platform?: string) {
  const calls: { url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const client = createLaunchClient({
    platform,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, calls };
}

describe("project client", () => {
  it("narrows lists with the bound platform", async () => {
    const { client, calls } = recordingClient("somm.finance");
    await client.deployments.projects();
    expect(calls[0]?.url).toBe(
      "/api/build/deployments/projects?platform=somm.finance",
    );
  });
  it("lets a per-call platform narrow the list", async () => {
    const { client, calls } = recordingClient("somm.finance");
    await client.deployments.projects({ platform: "community" });
    expect(calls[0]?.url).toContain("platform=community");
  });
  it("reads agent status through its owned project", async () => {
    const { client, calls } = recordingClient("community");
    await client.agentStatuses({ projectId: 1578 });
    expect(calls[0]?.url).toBe("/api/build/deployments/agents?projectId=1578");
  });
  it("keeps a derived client's platform independent", async () => {
    const { client, calls } = recordingClient("somm.finance");
    await client.forPlatform("community").deployments.projects();
    await client.deployments.projects();
    expect(calls.map(({ url }) => url)).toEqual([
      "/api/build/deployments/projects?platform=community",
      "/api/build/deployments/projects?platform=somm.finance",
    ]);
  });
  it("does not expose removed native lifecycle methods", () => {
    const { client } = recordingClient();
    expect(client).not.toHaveProperty("deploy");
    expect(client.deployments).not.toHaveProperty("promote");
  });
});
