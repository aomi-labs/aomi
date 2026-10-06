import { describe, expect, it, vi } from "vitest";
import { publicCatalog, projectPublicCatalog } from "./public-catalog";

describe("credential-free catalog projection", () => {
  it("drops private, inactive, installed and unclassified apps and private fields", () => {
    const value = projectPublicCatalog("apps", [
      {
        name: "public",
        is_public: true,
        is_active: true,
        metadata: { privateKey: "secret" },
        is_installed: true,
        secrets: ["secret"],
        chain_ids: [1],
      },
      { name: "private", is_public: false, is_active: true },
      { name: "unknown" },
      { name: "inactive", is_public: true, is_active: false },
    ]);
    expect(value).toEqual([
      { name: "public", is_public: true, is_active: true, chain_ids: [1] },
    ]);
  });
  it("sends no caller credentials or account filters and never returns upstream cookies", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json([{ name: "public", is_public: true, is_active: true }], {
        headers: { "set-cookie": "private=1" },
      }),
    );
    const response = await publicCatalog(
      new Request(
        "https://portal.example/api/public/catalog/apps?account_id=secret&platform=default&application_id=10",
        {
          headers: {
            authorization: "Bearer user",
            cookie: "private=1",
            origin: "https://partner.example",
            "x-thread-id": "account-bound-thread",
            "aomi-app-key": "private-app",
          },
        },
      ),
      "apps",
      fetcher,
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).search).toBe("?platform=default");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(new Headers(init.headers).has("cookie")).toBe(false);
    expect(new Headers(init.headers).has("aomi-app-key")).toBe(false);
    expect(new Headers(init.headers).get("x-thread-id")).toMatch(
      /^public-catalog-[0-9a-f-]{36}$/,
    );
    expect(init.credentials).toBe("omit");
    expect(response.headers.has("vary")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.get("cdn-cache-control")).toContain("max-age=1800");
  });
  it("satisfies the backend Thread extractor without reusing caller or prior private state", async () => {
    const ids: string[] = [];
    const fetcher = vi.fn().mockImplementation((url, init) => {
      const headers = new Headers(init.headers);
      const id = headers.get("x-thread-id");
      if (!id) return Promise.resolve(new Response(null, { status: 400 }));
      ids.push(id);
      return Promise.resolve(
        Response.json(
          new URL(url).pathname.endsWith("models") ? ["model"] : [],
        ),
      );
    });
    for (const kind of ["models", "apps", "models"])
      expect(
        (
          await publicCatalog(
            new Request(
              `https://portal.example/api/public/catalog/${kind}?thread_id=private`,
              {
                headers: {
                  "x-thread-id": "private",
                  authorization: "Bearer private",
                  cookie: "private=1",
                },
              },
            ),
            kind,
            fetcher,
          )
        ).status,
      ).toBe(200);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => /^public-catalog-[0-9a-f-]{36}$/.test(id))).toBe(
      true,
    );
    const skills = vi.fn().mockResolvedValue(Response.json({ skills: [] }));
    await publicCatalog(
      new Request("https://portal.example/api/public/catalog/skills"),
      "skills",
      skills,
    );
    expect(
      new Headers(skills.mock.calls[0][1].headers).has("x-thread-id"),
    ).toBe(false);
  });
  it("supports validators without caching errors", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json(["model"])));
    const first = await publicCatalog(
      new Request("https://portal.example/api/public/catalog/models"),
      "models",
      fetcher,
    );
    const second = await publicCatalog(
      new Request("https://portal.example/api/public/catalog/models", {
        headers: { "if-none-match": first.headers.get("etag")! },
      }),
      "models",
      fetcher,
    );
    expect(second.status).toBe(304);
    fetcher.mockResolvedValue(new Response(null, { status: 503 }));
    const unavailable = await publicCatalog(
      new Request("https://portal.example/api/public/catalog/models"),
      "models",
      fetcher,
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  });
  it("keeps only public skill cards and model strings", () => {
    expect(
      projectPublicCatalog("skills", {
        skills: [
          {
            id: "a",
            name: "A",
            instructions: "private body",
            metadata: { secret: "x" },
          },
        ],
        account: "private",
      }),
    ).toEqual({ skills: [{ id: "a", name: "A" }] });
    expect(projectPublicCatalog("models", ["model", { secret: "x" }])).toEqual([
      "model",
    ]);
  });
});
