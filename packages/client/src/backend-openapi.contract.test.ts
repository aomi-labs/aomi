import { describe, expect, it } from "vitest";
import backendOpenApiFixture from "./test-fixtures/backend-openapi.json";
import managerOpenApiFixture from "./test-fixtures/manager-openapi.json";
import {
  expectRouteContract,
  routeContractFromOpenApi,
  type OpenApiDocument,
} from "./test-fixtures/backend-openapi-contract";

describe("backend OpenAPI route contract", () => {
  it("keeps the client route manifest aligned with the checked-in backend OpenAPI fixture", () => {
    expectRouteContract(backendOpenApiFixture as OpenApiDocument);
  });

  it("retains every separately generated manager operation in the merged contract", () => {
    const managerRoutes = routeContractFromOpenApi(
      managerOpenApiFixture as OpenApiDocument,
    );
    const mergedRoutes = new Set(
      routeContractFromOpenApi(backendOpenApiFixture as OpenApiDocument),
    );

    // This is deliberately an explicit review point: silently dropping the
    // manager exporter from the generator must not shrink rollback safety.
    expect(managerRoutes).toHaveLength(77);
    expect(managerRoutes.every((route) => mergedRoutes.has(route))).toBe(true);
  });
});
