import { describe, expect, it } from "vitest";

import backendOpenApiFixture from "./fixtures/backend-openapi.json";
import managerOpenApiFixture from "./fixtures/manager-openapi.json";
import { AOMI_BACKEND_ENDPOINTS } from "./routes";
import type { AomiAuthClass, AomiHttpMethod } from "./routes";

type OpenApiOperation = {
  "x-aomi-auth"?: unknown;
};

type OpenApiDocument = {
  paths?: Record<
    string,
    Partial<Record<Lowercase<AomiHttpMethod>, OpenApiOperation>>
  >;
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

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
    expect(managerRoutes).toHaveLength(68);
    expect(managerRoutes.every((route) => mergedRoutes.has(route))).toBe(true);
  });

  it.runIf(process.env.AOMI_BACKEND_OPENAPI_URL)(
    "keeps the client route manifest aligned with a live backend OpenAPI document",
    async () => {
      const response = await fetch(process.env.AOMI_BACKEND_OPENAPI_URL!);

      expect(response.ok).toBe(true);
      expect(response.headers.get("content-type") ?? "").toContain(
        "application/json",
      );
      const openApi = (await response.json()) as OpenApiDocument;
      expectLiveRouteContract(openApi);
    },
  );
});

function expectRouteContract(openApi: OpenApiDocument) {
  const backendRoutes = routeContractFromOpenApi(openApi);
  const clientRoutes = routeContractFromClientManifest();

  expect(clientRoutes).toEqual(backendRoutes);
  expect(clientRoutes).toContain("GET /api/account [account]");
  expect(clientRoutes).not.toContain("GET /api/account [account_token]");
  expect(clientRoutes.some((route) => route.includes(" account_token"))).toBe(
    false,
  );
  expect(clientRoutes.some((route) => route.includes("/api/settings/"))).toBe(
    false,
  );
  expect(clientRoutes.some((route) => route.includes("/api/control/"))).toBe(
    false,
  );
}

function expectLiveRouteContract(openApi: OpenApiDocument) {
  const backendRoutes = routeContractFromOpenApi(openApi);
  const clientRoutes = routeContractFromClientManifest();
  const clientRouteSet = new Set(clientRoutes);
  const missingFromClient = backendRoutes.filter(
    (route) => !clientRouteSet.has(route),
  );

  expect(missingFromClient).toEqual([]);
  expect(clientRoutes).toContain("GET /api/account [account]");
  expect(clientRoutes).not.toContain("GET /api/account [account_token]");
  expect(clientRoutes.some((route) => route.includes(" account_token"))).toBe(
    false,
  );
  expect(clientRoutes.some((route) => route.includes("/api/settings/"))).toBe(
    false,
  );
  expect(clientRoutes.some((route) => route.includes("/api/control/"))).toBe(
    false,
  );
}

function routeContractFromClientManifest() {
  return AOMI_BACKEND_ENDPOINTS.map(
    ({ method, path, auth }) =>
      `${method} ${openApiPath(path)} ${authLabel(auth)}`,
  ).sort();
}

function routeContractFromOpenApi(openApi: OpenApiDocument) {
  const routes: string[] = [];

  for (const [path, pathItem] of Object.entries(openApi.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation =
        pathItem[method.toLowerCase() as Lowercase<AomiHttpMethod>];
      if (!operation) {
        continue;
      }

      const auth = operation["x-aomi-auth"];
      expect(isAomiAuthList(auth), `${method} ${path} x-aomi-auth`).toBe(true);
      routes.push(`${method} ${path} ${authLabel(auth)}`);
    }
  }

  return routes.sort();
}

function openApiPath(path: string) {
  return path.replaceAll(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function authLabel(auth: readonly AomiAuthClass[]) {
  return `[${auth.join(", ")}]`;
}

function isAomiAuthList(value: unknown): value is readonly AomiAuthClass[] {
  return Array.isArray(value) && value.every(isAomiAuthClass);
}

function isAomiAuthClass(value: unknown): value is AomiAuthClass {
  return (
    value === "thread" ||
    value === "account" ||
    value === "agent_adapter" ||
    value === "app_gate" ||
    value === "delegated" ||
    value === "service" ||
    value === "admin" ||
    value === "activation" ||
    value === "activation-or-wallet" ||
    value === "wallet" ||
    value === "wallet-session"
  );
}
