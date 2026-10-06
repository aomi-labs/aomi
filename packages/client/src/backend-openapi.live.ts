import { expect, it } from "vitest";
import {
  expectLiveRouteContract,
  type OpenApiDocument,
} from "./test-fixtures/backend-openapi-contract";

it("keeps the client route manifest aligned with the explicitly selected live backend", async () => {
  const url = process.env.AOMI_BACKEND_OPENAPI_URL;
  if (!url)
    throw new Error(
      "AOMI_BACKEND_OPENAPI_URL is required for the live contract lane",
    );
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  expect(response.ok).toBe(true);
  expect(response.headers.get("content-type") ?? "").toContain(
    "application/json",
  );
  expectLiveRouteContract((await response.json()) as OpenApiDocument);
}, 35_000);
