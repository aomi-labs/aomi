import { describe, expect, it } from "vitest";

import publicApi from "../../../apps/portal/openapi/aomi-agent-v1.json";

describe("public Agent, Pipeline, and Account OpenAPI snapshot", () => {
  it("freezes the Rust route manifest and excludes deleted chat controllers", () => {
    expect(publicApi["x-aomi-route-manifest"]).toHaveLength(77);
    expect(publicApi["x-aomi-route-manifest"]).toContain("POST /v1/task/build");
    expect(publicApi.paths["/v1/task/build"].post).toMatchObject({
      operationId: "buildTask",
      security: [{ aomiOAuth: ["task:build"] }],
    });
    const methods = new Set(["get", "post", "put", "patch", "delete"]);
    const routes = Object.entries(publicApi.paths).flatMap(
      ([path, operations]) =>
        Object.keys(operations)
          .filter((method) => methods.has(method))
          .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect([...publicApi["x-aomi-route-manifest"]].sort()).toEqual(
      routes.sort(),
    );
    expect(
      publicApi["x-aomi-route-manifest"].filter((route) =>
        route.includes("/v1/account/apps"),
      ),
    ).toEqual([
      "DELETE /v1/account/apps/{applicationId}",
      "DELETE /v1/account/apps/{applicationId}/secrets",
      "DELETE /v1/account/apps/{applicationId}/secrets/{name}",
      "GET /v1/account/apps",
      "GET /v1/account/apps/{applicationId}/secrets",
      "POST /v1/account/apps/{applicationId}",
      "POST /v1/account/apps/{applicationId}/secrets",
    ]);
    expect(
      publicApi["x-aomi-route-manifest"].filter((route) =>
        route.includes("/v1/agent/"),
      ),
    ).toEqual([
      "DELETE /v1/agent/sessions/{sessionId}",
      "GET /v1/agent/chat/{sessionId}",
      "GET /v1/agent/chat/{sessionId}/stream",
      "GET /v1/agent/sessions",
      "GET /v1/agent/sessions/{sessionId}",
      "GET /v1/agent/sessions/{sessionId}/resources",
      "GET /v1/agent/sessions/{sessionId}/resources/read",
      "PATCH /v1/agent/sessions/{sessionId}",
      "POST /v1/agent/chat",
      "POST /v1/agent/chat/{sessionId}/actions/{actionId}/result",
      "POST /v1/agent/chat/{sessionId}/interrupt",
      "POST /v1/agent/mcp",
    ]);
    for (const removed of ["chat", "state", "interrupt"].map(
      (route) => `/api/thread/${route}`,
    )) {
      expect(publicApi.paths).not.toHaveProperty(removed);
    }
    expect(publicApi.paths["/v1/pipeline/mcp"].post.operationId).toBe(
      "pipelineMcp",
    );
  });

  it("keeps resource inspection scoped to Agent read grants and concrete page types", () => {
    for (const [path, operationId, schema] of [
      ["/v1/agent/sessions/{sessionId}/resources", "listResources", "ResourceList"],
      ["/v1/agent/sessions/{sessionId}/resources/read", "readResource", "ResourceRead"],
    ] as const) {
      expect(publicApi.paths[path].get).toMatchObject({
        operationId,
        security: [{ aomiOAuth: ["agent:read"] }],
        responses: {
          "200": {
            description: "Authorized retained data; private, no-store",
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${schema}` },
              },
            },
          },
        },
      });
    }
  });

  it("defines one concrete Event stream with Action as an Event", () => {
    const schemas = publicApi.components.schemas;
    expect(publicApi.info.description).toBe(
      "Intent enters the runtime; one ordered stream of concrete Events leaves it. Actions are durable Events whose nested ActionRequest requires a client response.",
    );
    expect(schemas.ConcreteEvent).toMatchObject({
      discriminator: { propertyName: "type" },
      oneOf: expect.arrayContaining([
        { $ref: "#/components/schemas/MessageEvent" },
        { $ref: "#/components/schemas/TurnStateChangedEvent" },
        { $ref: "#/components/schemas/Action" },
      ]),
    });
    expect(schemas.ConcreteEvent.discriminator.mapping.action).toBe(
      "#/components/schemas/Action",
    );
    expect(schemas.EventPage).toMatchObject({
      required: ["session_id", "cursor", "events", "has_more"],
      additionalProperties: false,
      properties: {
        events: {
          type: "array",
          items: { $ref: "#/components/schemas/ConcreteEvent" },
        },
      },
    });
    expect(schemas.Action.allOf).toContainEqual({
      $ref: "#/components/schemas/EventMeta",
    });
  });

  it("keeps transaction types nested in ActionRequest and out of Event vocabulary", () => {
    const schemas = publicApi.components.schemas;
    const requestTypes = schemas.ActionRequest.oneOf.map((variant) =>
      "properties" in variant
        ? variant.properties.type.const
        : variant.allOf[1].properties.type.const,
    );
    expect(requestTypes).toEqual(["execute_evm", "execute_svm", "sign"]);
    expect(schemas.AssembledEvmTransaction.required).toEqual([
      "chain_id",
      "from",
      "to",
      "data",
      "label",
      "kind",
    ]);
    expect(schemas.AssembledEvmTransaction.properties).not.toHaveProperty(
      "status",
    );
    for (const deleted of [
      "Activity",
      "AgentActivity",
      "AgentAction",
      "AgentDelta",
      "TxApproval",
      "WalletRequest",
      "SigPending",
      "ChatStateResponse",
    ]) {
      expect(schemas).not.toHaveProperty(deleted);
    }
  });

  it("limits client UserState to connection, wallets, preferences, and extensions", () => {
    expect(publicApi.components.schemas.UserState.properties).toEqual({
      connection: { $ref: "#/components/schemas/UserStateConnection" },
      evm: { $ref: "#/components/schemas/UserStateEvm" },
      svm: { $ref: "#/components/schemas/UserStateSvm" },
      preferences: { type: "object", additionalProperties: true },
      ext: { type: "object", additionalProperties: true },
    });
    expect(
      publicApi.components.schemas.UserStateConnection.additionalProperties,
    ).toBe(false);
    expect(publicApi.components.schemas.UserStateEvm.additionalProperties).toBe(
      false,
    );
    expect(publicApi.components.schemas.UserStateSvm.additionalProperties).toBe(
      false,
    );
  });
});
