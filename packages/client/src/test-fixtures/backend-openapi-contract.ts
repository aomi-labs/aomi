import { expect } from "vitest";
import { AOMI_BACKEND_ENDPOINTS } from "./routes";
import type { AomiAuthClass, AomiHttpMethod } from "./routes";

export type OpenApiOperation = {
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: JsonSchema }>;
  };
  responses?: Record<
    string,
    { content?: Record<string, { schema?: JsonSchema }> }
  >;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: JsonSchema;
  }>;
  "x-aomi-auth"?: unknown;
};

export type OpenApiDocument = {
  paths?: Record<
    string,
    Partial<Record<Lowercase<AomiHttpMethod>, OpenApiOperation>>
  >;
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export function expectRouteContract(openApi: OpenApiDocument) {
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

export function expectLiveRouteContract(
  openApi: OpenApiDocument,
  consumer?: OpenApiDocument,
) {
  const requiredRoutes = consumer
    ? routeContractFromOpenApi(consumer)
    : routeContractFromClientManifest();
  const required = new Set(
    requiredRoutes.map((route) => route.slice(0, route.indexOf(" ["))),
  );
  const backendRoutes = routeContractFromOpenApi(openApi, required);
  const clientRoutes = requiredRoutes;
  const backendRouteSet = new Set(backendRoutes);
  const missingFromBackend = clientRoutes.filter(
    (route) => !backendRouteSet.has(route),
  );

  expect(
    missingFromBackend,
    "Client-required method/path/auth missing from target backend",
  ).toEqual([]);
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

export function routeContractFromOpenApi(
  openApi: OpenApiDocument,
  required?: Set<string>,
) {
  const routes: string[] = [];

  for (const [path, pathItem] of Object.entries(openApi.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation =
        pathItem[method.toLowerCase() as Lowercase<AomiHttpMethod>];
      if (!operation || (required && !required.has(`${method} ${path}`))) {
        continue;
      }

      const auth = operation["x-aomi-auth"];
      expect(isAomiAuthList(auth), `${method} ${path} x-aomi-auth`).toBe(true);
      if (!isAomiAuthList(auth)) {
        throw new Error(
          `${method} ${path} has an invalid x-aomi-auth contract`,
        );
      }
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
    value === "public" ||
    value === "thread" ||
    value === "account" ||
    value === "agent_adapter" ||
    value === "app_gate" ||
    value === "delegated" ||
    value === "service" ||
    value === "admin" ||
    value === "activation" ||
    value === "activation-admin" ||
    value === "activation-or-wallet" ||
    value === "wallet" ||
    value === "wallet-session"
  );
}

// A conservative structural check for the inline JSON schemas exported by Aomi.
// Unknown constraints fail closed on changes; descriptions/examples do not affect wire compatibility.
export type JsonSchema = {
  type?: string;
  nullable?: boolean;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  [key: string]: unknown;
};

export function expectSchemaSubset(
  values: JsonSchema,
  accepted: JsonSchema,
  location: string,
) {
  if (values.nullable)
    expect(accepted.nullable, `${location}: nullability`).toBe(true);
  if (accepted.type)
    expect(values.type, `${location}: type`).toBe(accepted.type);
  if (accepted.enum) {
    expect(values.enum, `${location}: enum must remain bounded`).toBeDefined();
    for (const value of values.enum ?? [])
      expect(accepted.enum, `${location}: enum`).toContainEqual(value);
  }
  for (const key of accepted.required ?? []) {
    expect(values.required ?? [], `${location}: required ${key}`).toContain(
      key,
    );
  }
  for (const [key, schema] of Object.entries(accepted.properties ?? {})) {
    const actual = values.properties?.[key];
    if (actual) expectSchemaSubset(actual, schema, `${location}.${key}`);
    else if (accepted.required?.includes(key))
      throw new Error(`${location}: missing ${key}`);
  }
  if (accepted.items) {
    expect(values.items, `${location}: items`).toBeDefined();
    expectSchemaSubset(values.items!, accepted.items, `${location}[]`);
  }
  const understood = new Set([
    "type",
    "nullable",
    "enum",
    "required",
    "properties",
    "items",
    "title",
    "description",
    "example",
    "examples",
    "default",
    "deprecated",
    "readOnly",
    "writeOnly",
  ]);
  for (const key of Object.keys(accepted)) {
    if (!understood.has(key))
      expect(values[key], `${location}: ${key}`).toEqual(accepted[key]);
  }
}

export function expectConsumerShapes(
  required: OpenApiDocument,
  provided: OpenApiDocument,
) {
  for (const [path, methods] of Object.entries(required.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const key = method.toLowerCase() as Lowercase<AomiHttpMethod>;
      const consumer = methods[key];
      if (!consumer) continue;
      const backend = provided.paths?.[path]?.[key];
      expect(backend, `${method} ${path}`).toBeDefined();
      const at = `${method} ${path}`;
      // Requests: every value the consumer sends must be accepted by the backend.
      for (const parameter of backend!.parameters ?? []) {
        const sent = consumer.parameters?.find(
          (p) => p.in === parameter.in && p.name === parameter.name,
        );
        if (parameter.required)
          expect(sent?.required, `${at}: parameter ${parameter.name}`).toBe(
            true,
          );
        if (sent?.schema && parameter.schema)
          expectSchemaSubset(
            sent.schema,
            parameter.schema,
            `${at} ${parameter.name}`,
          );
      }
      if (backend!.requestBody?.required)
        expect(consumer.requestBody?.required, `${at}: request body`).toBe(
          true,
        );
      for (const [media, body] of Object.entries(
        consumer.requestBody?.content ?? {},
      )) {
        const target = backend!.requestBody?.content?.[media]?.schema;
        expect(target, `${at}: request ${media}`).toBeDefined();
        if (body.schema)
          expectSchemaSubset(body.schema, target!, `${at} request`);
      }
      // Responses: backend values must satisfy the fields read by this consumer.
      for (const [status, response] of Object.entries(
        consumer.responses ?? {},
      )) {
        if (!status.startsWith("2")) continue;
        for (const [media, body] of Object.entries(response.content ?? {})) {
          const actual = backend!.responses?.[status]?.content?.[media]?.schema;
          expect(actual, `${at}: response ${status} ${media}`).toBeDefined();
          if (body.schema)
            expectSchemaSubset(
              actual!,
              body.schema,
              `${at} response ${status}`,
            );
        }
      }
    }
  }
}
