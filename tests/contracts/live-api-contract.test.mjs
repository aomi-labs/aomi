import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeApiDocuments } from "../../scripts/live-api-contract.mjs";
test("live target includes Manager routes and retains backend response shapes", () => {
  const backend = {
    paths: {
      "/api/account": {
        get: {
          "x-aomi-auth": ["account"],
          responses: {
            200: {
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
  };
  const manager = {
    paths: { "/api/account/bots": { get: { "x-aomi-auth": ["account"] } } },
  };
  const merged = mergeApiDocuments(backend, manager);
  assert.deepEqual(merged.paths["/api/account"], backend.paths["/api/account"]);
  assert.deepEqual(
    merged.paths["/api/account/bots"],
    manager.paths["/api/account/bots"],
  );
  assert.equal(backend.paths["/api/account/bots"], undefined);
});
test("conflicting provider method contracts fail closed", () => {
  assert.throws(() =>
    mergeApiDocuments(
      { paths: { "/same": { get: { "x-aomi-auth": ["account"] } } } },
      { paths: { "/same": { get: { "x-aomi-auth": ["public"] } } } },
    ),
  );
});
