import { describe, expect, it } from "vitest";
import fixture from "./test-fixtures/backend-openapi.json";
import {
  expectLiveRouteContract,
  expectRouteContract,
  expectConsumerShapes,
  type OpenApiDocument,
} from "./test-fixtures/backend-openapi-contract";

const copy = () => structuredClone(fixture) as OpenApiDocument;
describe("frontend-owned API compatibility", () => {
  it("allows backend additions, including unrelated auth classes", () => {
    const backend = copy();
    backend.paths!["/api/new-backend-only"] = {
      get: { "x-aomi-auth": ["future-backend-auth"] },
    };
    expectLiveRouteContract(backend);
    expectConsumerShapes(fixture as OpenApiDocument, backend);
  });
  it("keeps offline generated-client drift equality", () => {
    const backend = copy();
    backend.paths!["/api/new-backend-only"] = {
      get: { "x-aomi-auth": ["public"] },
    };
    expect(() => expectRouteContract(backend)).toThrow();
  });
  it.each(["route", "method", "auth"])(
    "rejects an unavailable required %s",
    (kind) => {
      const backend = copy();
      if (kind === "route") delete backend.paths!["/api/account"];
      if (kind === "method") delete backend.paths!["/api/account"].get;
      if (kind === "auth")
        backend.paths!["/api/account"].get!["x-aomi-auth"] = ["public"];
      expect(() => expectLiveRouteContract(backend)).toThrow();
    },
  );
  const contract = (schema: object, request = false) =>
    ({
      paths: {
        "/critical": {
          post: request
            ? {
                requestBody: {
                  required: true,
                  content: { "application/json": { schema } },
                },
              }
            : {
                responses: {
                  "200": { content: { "application/json": { schema } } },
                },
              },
        },
      },
    }) as OpenApiDocument;
  const profile = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  };
  it("accepts additive response fields", () => {
    expectConsumerShapes(
      contract(profile),
      contract({
        ...profile,
        required: ["id", "name"],
        properties: { ...profile.properties, name: { type: "string" } },
      }),
    );
  });
  it("rejects missing, optional, nullable or retyped response fields", () => {
    for (const schema of [
      { type: "object" },
      { ...profile, required: [] },
      { ...profile, properties: { id: { type: "number" } } },
      { ...profile, properties: { id: { type: "string", nullable: true } } },
    ]) {
      expect(() =>
        expectConsumerShapes(contract(profile), contract(schema)),
      ).toThrow();
    }
  });
  it("rejects newly required request fields but accepts optional additions", () => {
    const added = {
      ...profile,
      properties: { ...profile.properties, amount: { type: "number" } },
    };
    expectConsumerShapes(contract(profile, true), contract(added, true));
    expect(() =>
      expectConsumerShapes(
        contract(profile, true),
        contract({ ...added, required: ["id", "amount"] }, true),
      ),
    ).toThrow();
  });
});
