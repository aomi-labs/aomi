// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackendClient } from "../backend";

let client: BackendClient;

beforeEach(() => {
  client = new BackendClient({
    aomi: {
      backendUrl: "https://staging-api.example.com",
      activationToken: "act-token",
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listDeploymentRecords", () => {
  it("maps snake_case records to camelCase", async () => {
    const payload = {
      ok: true,
      app: "my-bot",
      current_release_tag: "apps-1-r0123abcdef-my-bot-bbbbbbbbbbbb",
      records: [
        {
          deployment_id: "dep_1_r0123abcdef_bbbbbbbbbbbb",
          release_tag: "apps-1-r0123abcdef-my-bot-bbbbbbbbbbbb",
          actor: "cecilia",
          created_at: "2025-06-15T15:06:40Z",
          sdk_version: "3.0.1",
          current: true,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.listDeploymentRecords({
      platform: "community",
      app: "my-bot",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/platforms/community/apps/my-bot/records");
    expect(result.app).toBe("my-bot");
    expect(result.currentReleaseTag).toBe(
      "apps-1-r0123abcdef-my-bot-bbbbbbbbbbbb",
    );
    expect(result.records[0]).toEqual({
      deploymentId: "dep_1_r0123abcdef_bbbbbbbbbbbb",
      releaseTag: "apps-1-r0123abcdef-my-bot-bbbbbbbbbbbb",
      actor: "cecilia",
      createdAt: 1750000000,
      sdkVersion: "3.0.1",
      current: true,
    });
  });
});
