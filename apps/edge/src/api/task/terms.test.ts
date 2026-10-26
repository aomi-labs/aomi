/**
 * Byte pins for the venue-facing Task documents. `fixtures/` was captured from
 * the backend that served these before the edge did (product-mono 510466af:
 * api-server `task/discovery.rs`, payment `task::challenge`) by running those
 * exact functions over the terms in `fixtures.ts`. `canonical-openapi.json` is
 * the API Server's /openapi.json trimmed to what the Task projection reads,
 * plus one non-Task path and component it must drop.
 */
import { describe, expect, it } from "vitest";

import canonicalText from "./fixtures/canonical-openapi.json?raw";
import { terms } from "./test-terms";
import { parseOrdered, stringifyOrdered } from "./json";
import type { EdgeEnv } from "../../env";
import { resetTermsCache, TaskTerms, taskTerms } from "./terms";

describe("ordered JSON", () => {
  it("round-trips the canonical contract, integer-like keys included", () => {
    expect(stringifyOrdered(parseOrdered(canonicalText))).toBe(canonicalText);
    expect(stringifyOrdered(parseOrdered('{"404":1,"402":2,"default":3}'))).toBe('{"404":1,"402":2,"default":3}');
  });
});

describe("Task terms", () => {
  it("accepts only a bare https build resource", () => {
    expect(TaskTerms.safeParse(terms(false)).success).toBe(true);
    for (const resource_url of [
      "http://api.aomi.dev/v1/task/build",
      "https://api.aomi.dev:8443/v1/task/build",
      "https://api.aomi.dev/v1/task/build?x=1",
      "https://api.aomi.dev/v1/task/other",
      "https://user@api.aomi.dev/v1/task/build",
    ])
      expect(TaskTerms.safeParse({ ...terms(false), resource_url }).success).toBe(false);
  });
});

describe("taskTerms", () => {
  const env = { PAYMENT_ORIGIN: "https://payment.example/" } as unknown as EdgeEnv;

  it("reads Payment's public terms once and serves them from cache", async () => {
    resetTermsCache();
    const seen: string[] = [];
    const fetchImpl = async (request: Request) => {
      seen.push(request.url);
      return Response.json(terms(true));
    };
    expect(await taskTerms(env, fetchImpl)).toEqual(terms(true));
    expect(await taskTerms(env, fetchImpl)).toEqual(terms(true));
    expect(seen).toEqual(["https://payment.example/v1/payment/task/terms"]);
  });

  it("fails closed without Payment or with terms it cannot publish", async () => {
    resetTermsCache();
    await expect(taskTerms({} as EdgeEnv, async () => Response.json(terms(true)))).rejects.toMatchObject({ status: 503 });
    await expect(taskTerms(env, async () => new Response("down", { status: 500 }))).rejects.toMatchObject({ status: 503 });
    await expect(
      taskTerms(env, async () => Response.json({ ...terms(true), resource_url: "https://api.aomi.dev/other" })),
    ).rejects.toMatchObject({ status: 502, code: "invalid_task_terms" });
  });
});
