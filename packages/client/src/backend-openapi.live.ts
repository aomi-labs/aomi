import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import consumerContract from "./test-fixtures/backend-openapi.json";
import {
  expectLiveRouteContract,
  expectConsumerShapes,
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
  const backend = (await response.json()) as OpenApiDocument;
  const requirements = process.env.AOMI_CONSUMER_CONTRACT_FILE
    ? (JSON.parse(
        readFileSync(process.env.AOMI_CONSUMER_CONTRACT_FILE, "utf8"),
      ) as OpenApiDocument)
    : (consumerContract as OpenApiDocument);
  expectLiveRouteContract(backend, requirements);
  expectConsumerShapes(requirements, backend);
}, 35_000);
