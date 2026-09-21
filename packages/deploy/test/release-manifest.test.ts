import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchReleaseSecretSlots,
  missingSecretsForActivation,
} from "../src/bff/release-manifest";
import type { BackendClient } from "../src/backend";

function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const hit = routes[url];
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(hit.body), { status: hit.status });
  }) as unknown as typeof fetch;
}

const RELEASE_URL =
  "https://api.github.com/repos/aomi-labs/community/releases/tags/v1";

describe("fetchReleaseSecretSlots", () => {
  it("returns the declared slots per app", async () => {
    const fetchImpl = fakeFetch({
      [RELEASE_URL]: {
        status: 200,
        body: {
          assets: [
            { name: "manifest.json", url: "https://api.github.com/asset/1" },
          ],
        },
      },
      "https://api.github.com/asset/1": {
        status: 200,
        body: {
          plugins: {
            binance: {
              file: "libbinance.dylib",
              sha256: "x",
              secrets: [
                {
                  name: "BINANCE_API_KEY",
                  description: "d",
                  required: true,
                  user_own: true,
                },
              ],
            },
          },
        },
      },
    });

    const slots = await fetchReleaseSecretSlots({
      platformRepo: "aomi-labs/community",
      releaseTag: "v1",
      githubToken: "t",
      fetchImpl,
    });

    expect(slots.binance).toEqual([
      {
        name: "BINANCE_API_KEY",
        description: "d",
        required: true,
        user_own: true,
      },
    ]);
  });

  it("returns {} when the release has no manifest.json (older releases)", async () => {
    const fetchImpl = fakeFetch({
      [RELEASE_URL]: { status: 200, body: { assets: [] } },
    });
    await expect(
      fetchReleaseSecretSlots({
        platformRepo: "aomi-labs/community",
        releaseTag: "v1",
        githubToken: "t",
        fetchImpl,
      }),
    ).resolves.toEqual({});
  });

  it("throws when the release cannot be read", async () => {
    const fetchImpl = fakeFetch({});
    await expect(
      fetchReleaseSecretSlots({
        platformRepo: "aomi-labs/community",
        releaseTag: "v1",
        githubToken: "t",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "RequiredSecretsCheckError",
      code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE",
      upstream: "github",
      upstreamStatus: 404,
    });
  });

  it("throws when the fetch call rejects (network failure)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = fetchReleaseSecretSlots({
      platformRepo: "aomi-labs/community",
      releaseTag: "v1",
      githubToken: "t",
      fetchImpl,
    });
    await expect(result).rejects.toMatchObject({
      name: "RequiredSecretsCheckError",
      code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE",
      upstream: "github",
      cause: expect.objectContaining({ message: "network down" }),
    });
  });

  it("throws when the release response body is not valid JSON", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === RELEASE_URL) {
        return new Response("<html>oops</html>", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(
      fetchReleaseSecretSlots({
        platformRepo: "aomi-labs/community",
        releaseTag: "v1",
        githubToken: "t",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "RequiredSecretsCheckError",
      code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE",
    });
  });

  it("throws when the asset response body is not valid JSON", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === RELEASE_URL) {
        return new Response(
          JSON.stringify({
            assets: [
              { name: "manifest.json", url: "https://api.github.com/asset/1" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "https://api.github.com/asset/1") {
        return new Response("<html>oops</html>", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(
      fetchReleaseSecretSlots({
        platformRepo: "aomi-labs/community",
        releaseTag: "v1",
        githubToken: "t",
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "RequiredSecretsCheckError",
      code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE",
    });
  });
});

describe("missingSecretsForActivation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports only the required slots with no configured key", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === RELEASE_URL) {
        return new Response(
          JSON.stringify({
            assets: [
              { name: "manifest.json", url: "https://api.github.com/asset/1" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "https://api.github.com/asset/1") {
        return new Response(
          JSON.stringify({
            plugins: {
              binance: {
                file: "libbinance.dylib",
                sha256: "x",
                secrets: [
                  { name: "BINANCE_API_KEY", description: "d", required: true },
                  {
                    name: "BINANCE_SECRET_KEY",
                    description: "d",
                    required: true,
                  },
                  {
                    name: "BINANCE_USER_KEY",
                    description: "User trading key",
                    required: true,
                    user_own: true,
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const client = {
      listAppSecrets: vi.fn(async () => ({
        byApp: { binance: ["$SECRET:APP:binance::BINANCE_API_KEY"] },
      })),
      // Production shape: `listUserProjects` (the source of `input.source`)
      // deliberately returns `latest_deployment: null` — the helper must
      // resolve `platformRepo` itself via the detail endpoint.
      getUserProjectLatestDeployment: vi.fn(async () => ({
        platformRepo: "aomi-labs/community",
      })),
    } as unknown as BackendClient;

    const missing = await missingSecretsForActivation({
      client,
      githubUserId: "gh-1",
      githubToken: "t",
      project: {
        id: 42,
        latestDeployment: null,
        apps: [{ id: 17, name: "binance" }],
      } as never,
      pairs: [{ app: "binance", releaseTag: "v1" }],
    });
    expect(missing).toEqual({ binance: ["BINANCE_SECRET_KEY"] });
    expect(client.getUserProjectLatestDeployment).toHaveBeenCalledWith({
      githubUserId: "gh-1",
      projectId: 42,
    });
  });

  it("blocks activation when the platform repo is unknown", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    // No deployment at all for this source: the detail endpoint itself
    // returns null, so the release manifest cannot be verified.
    const client = {
      listAppSecrets: vi.fn(),
      getUserProjectLatestDeployment: vi.fn(async () => null),
    } as unknown as BackendClient;
    await expect(
      missingSecretsForActivation({
        client,
        githubUserId: "gh-1",
        githubToken: "t",
        project: { id: 42, latestDeployment: null } as never,
        pairs: [{ app: "binance", releaseTag: "v1" }],
      }),
    ).rejects.toMatchObject({ code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.listAppSecrets).not.toHaveBeenCalled();
  });

  it("blocks activation when the GitHub token is absent", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubEnv("GITHUB_TOKEN", "");

    const client = {
      listAppSecrets: vi.fn(),
      getUserProjectLatestDeployment: vi.fn(async () => ({
        platformRepo: "aomi-labs/community",
      })),
    } as unknown as BackendClient;

    await expect(
      missingSecretsForActivation({
        client,
        githubUserId: "gh-1",
        githubToken: undefined,
        project: { id: 42, latestDeployment: null } as never,
        pairs: [{ app: "binance", releaseTag: "v1" }],
      }),
    ).rejects.toMatchObject({ code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE" });
    expect(client.getUserProjectLatestDeployment).not.toHaveBeenCalled();
    expect(client.listAppSecrets).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks when getUserProjectLatestDeployment rejects", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    const backendError = new Error("backend unavailable");
    const client = {
      listAppSecrets: vi.fn(),
      getUserProjectLatestDeployment: vi.fn(async () => {
        throw backendError;
      }),
    } as unknown as BackendClient;

    await expect(
      missingSecretsForActivation({
        client,
        githubUserId: "gh-1",
        githubToken: "t",
        project: { id: 42, latestDeployment: null } as never,
        pairs: [{ app: "binance", releaseTag: "v1" }],
      }),
    ).rejects.toMatchObject({
      code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE",
      upstream: "rust",
      cause: backendError,
    });
    expect(client.listAppSecrets).not.toHaveBeenCalled();
  });

  /** A manifest covers every app in its release, so apps activated together on
   *  one tag must cost one fetch pair — not one per app. This is the common
   *  shape: a project's apps ship in the same release. */
  it("fetches a shared release manifest once for all apps on the tag", async () => {
    const manifest = {
      plugins: Object.fromEntries(
        ["alpha", "beta", "gamma"].map((app) => [
          app,
          {
            secrets: [
              {
                name: `${app.toUpperCase()}_KEY`,
                description: "d",
                required: true,
              },
            ],
          },
        ]),
      ),
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === RELEASE_URL) {
        return new Response(
          JSON.stringify({
            assets: [
              { name: "manifest.json", url: "https://api.github.com/asset/1" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "https://api.github.com/asset/1") {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const client = {
      listAppSecrets: vi.fn(async () => ({ byApp: {} })),
      getUserProjectLatestDeployment: vi.fn(async () => ({
        platformRepo: "aomi-labs/community",
      })),
    } as unknown as BackendClient;

    const missing = await missingSecretsForActivation({
      client,
      githubUserId: "gh-1",
      githubToken: "t",
      project: {
        id: 42,
        latestDeployment: null,
        apps: ["alpha", "beta", "gamma"].map((name, index) => ({
          id: index + 1,
          name,
        })),
      } as never,
      pairs: ["alpha", "beta", "gamma"].map((app) => ({
        app,
        releaseTag: "v1",
      })),
    });

    // Every app is still gated on its own declarations.
    expect(missing).toEqual({
      alpha: ["ALPHA_KEY"],
      beta: ["BETA_KEY"],
      gamma: ["GAMMA_KEY"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /** Distinct tags cannot be deduplicated, so they must instead stay under the
   *  in-flight cap while still all being fetched. */
  it("caps in-flight manifest reads when every app has its own tag", async () => {
    const apps = ["a", "b", "c", "d", "e", "f"];
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const tagMatch = url.match(/releases\/tags\/(.+)$/);
      if (tagMatch) {
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: "manifest.json",
                url: `https://api.github.com/asset/${tagMatch[1]}`,
              },
            ],
          }),
          { status: 200 },
        );
      }
      const app = url.split("/asset/tag-")[1];
      return new Response(
        JSON.stringify({
          plugins: {
            [app]: {
              secrets: [
                {
                  name: `${app.toUpperCase()}_KEY`,
                  description: "d",
                  required: true,
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchImpl);

    const client = {
      listAppSecrets: vi.fn(async () => ({ byApp: {} })),
      getUserProjectLatestDeployment: vi.fn(async () => ({
        platformRepo: "aomi-labs/community",
      })),
    } as unknown as BackendClient;

    const missing = await missingSecretsForActivation({
      client,
      githubUserId: "gh-1",
      githubToken: "t",
      project: {
        id: 42,
        latestDeployment: null,
        apps: apps.map((name, index) => ({ id: index + 1, name })),
      } as never,
      pairs: apps.map((app) => ({ app, releaseTag: `tag-${app}` })),
    });

    // No app is skipped by the limiter — all six are still gated.
    expect(Object.keys(missing).sort()).toEqual(apps);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  /** One unreadable manifest must fail the whole gate. Parallelism must not
   *  turn a verification failure into a silently skipped app. */
  it("still blocks when one tag's manifest cannot be read", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/releases/tags/good")) {
        return new Response(JSON.stringify({ assets: [] }), { status: 200 });
      }
      return new Response("boom", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const client = {
      listAppSecrets: vi.fn(async () => ({ byApp: {} })),
      getUserProjectLatestDeployment: vi.fn(async () => ({
        platformRepo: "aomi-labs/community",
      })),
    } as unknown as BackendClient;

    await expect(
      missingSecretsForActivation({
        client,
        githubUserId: "gh-1",
        githubToken: "t",
        project: {
          id: 42,
          latestDeployment: null,
          apps: [
            { id: 1, name: "ok" },
            { id: 2, name: "broken" },
          ],
        } as never,
        pairs: [
          { app: "ok", releaseTag: "good" },
          { app: "broken", releaseTag: "bad" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "REQUIRED_SECRETS_CHECK_UNAVAILABLE",
    });
  });
});
