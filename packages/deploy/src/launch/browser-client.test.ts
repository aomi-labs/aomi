// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createLaunchClient } from "../src/launch/browser-client";

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

describe("createLaunchClient — bound platform", () => {
  it("carries the bound platform only into platform bootstrap calls", async () => {
    const { client, calls } = recordingClient("somm.finance");

    await client.status({ deploymentId: "d-1" });
    await client.preflight({ repo: "alice/demo" });
    await client.createRepo({ installationId: "55" });

    expect(calls[0]?.url).toContain("platform=somm.finance");
    expect(calls[1]?.body).not.toHaveProperty("platform");
    expect(calls[2]?.body).toMatchObject({ platform: "somm.finance" });
  });

  it("never sends a platform on project-scoped calls, bound or not", async () => {
    const { client, calls } = recordingClient("somm.finance");

    await client.deployments.history({ projectId: 7 });
    await client.deployments.secrets({ projectId: 7 });
    await client.deployments.requiredSecrets({ projectId: 7 });
    await client.deploy({ projectId: 7, sourceRef: "abc123" });
    await client.redeploy({ projectId: 7 });
    await client.activate({ projectId: 7, releaseTags: ["t1"] });
    await client.deployments.promote({ deploymentId: "d-1", projectId: 7 });
    await client.deployments.deactivate({ projectId: 7, apps: ["demo"] });
    await client.deployments.records({ app: "demo", projectId: 7 });

    for (const { url, body } of calls) {
      expect(url).not.toContain("platform=");
      if (body) expect(body).not.toHaveProperty("platform");
    }
  });

  it("keeps platform addressing for records without a project", async () => {
    const { client, calls } = recordingClient("somm.finance");

    await client.deployments.records({ app: "demo" });

    expect(calls[0]?.url).toContain("platform=somm.finance");
  });

  it("lets an explicit per-call platform win on pre-project reads", async () => {
    const { client, calls } = recordingClient("somm.finance");

    await client.status({ deploymentId: "d-1", platform: "community" });

    expect(calls[0]?.url).toContain("platform=community");
    expect(calls[0]?.url).not.toContain("somm.finance");
  });

  it("omits platform entirely when none is bound", async () => {
    const { client, calls } = recordingClient();

    await client.status({ deploymentId: "d-1" });
    await client.deploy({ projectId: 7, sourceRef: "abc123" });

    expect(calls[0]?.url).not.toContain("platform=");
    expect(calls[1]?.body).not.toHaveProperty("platform");
  });

  it("derives a differently-scoped client without mutating the original", async () => {
    const { client, calls } = recordingClient("somm.finance");
    const other = client.forPlatform("community");

    await other.status({ deploymentId: "d-1" });
    await client.status({ deploymentId: "d-2" });

    expect(client.platform).toBe("somm.finance");
    expect(other.platform).toBe("community");
    expect(calls[0]?.url).toContain("platform=community");
    expect(calls[1]?.url).toContain("platform=somm.finance");
  });

  it("routes the two mounts to their own paths", async () => {
    const { client, calls } = recordingClient();

    await client.status({ deploymentId: "d-1" });
    await client.deployments.status({ deploymentId: "d-1" });

    expect(calls[0]?.url).toContain("/api/bff/launch/status");
    expect(calls[1]?.url).toContain("/api/bff/deployments/status");
  });

  it("reads all runtime statuses through the project-scoped batch route", async () => {
    const { client, calls } = recordingClient("community");

    await client.appStatuses({ projectId: 1578 });

    expect(calls[0]?.url).toBe("/api/bff/launch/apps?projectId=1578");
  });
});
