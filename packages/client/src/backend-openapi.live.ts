import { readFileSync } from "node:fs";
import { it } from "vitest";
// @ts-expect-error The workflow helper is JavaScript shared with native Node tests.
import {
  fetchApiDocument,
  mergeApiDocuments,
} from "../../../scripts/live-api-contract.mjs";
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
  const managerUrl = new URL("/api/manager/openapi.json", url).href;
  const [backendDocument, managerDocument] = await Promise.all([
    fetchApiDocument(url),
    fetchApiDocument(managerUrl),
  ]);
  const backend = mergeApiDocuments(
    backendDocument,
    managerDocument,
  ) as OpenApiDocument;
  const requirements = process.env.AOMI_CONSUMER_CONTRACT_FILE
    ? (JSON.parse(
        readFileSync(process.env.AOMI_CONSUMER_CONTRACT_FILE, "utf8"),
      ) as OpenApiDocument)
    : (consumerContract as OpenApiDocument);
  expectLiveRouteContract(backend, requirements);
  expectConsumerShapes(requirements, backend);
}, 65_000);
