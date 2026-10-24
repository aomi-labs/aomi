import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicApiContract } from "./public-api-contract.mjs";

test("SDK composition preserves both owners and rejects ambiguous contracts", () => {
  const dir = mkdtempSync(join(tmpdir(), "aomi-contract-"));
  const original = [
    process.env.AOMI_AGENT_OPENAPI_FILE,
    process.env.AOMI_PAYMENT_OPENAPI_FILE,
  ];
  try {
    process.env.AOMI_AGENT_OPENAPI_FILE = join(dir, "api.json");
    process.env.AOMI_PAYMENT_OPENAPI_FILE = join(dir, "payment.json");
    const api = {
      paths: { "/v1/agent/chat": { post: {} } },
      components: { schemas: { Error: { type: "object" } } },
      "x-aomi-route-manifest": ["POST /v1/agent/chat"],
    };
    const payment = {
      paths: { "/v1/account/credits": { get: {} } },
      components: {
        schemas: {
          Error: { type: "object" },
          CreditBalance: { type: "object" },
        },
      },
      "x-aomi-route-manifest": ["GET /v1/account/credits"],
    };
    const write = () => {
      writeFileSync(process.env.AOMI_AGENT_OPENAPI_FILE, JSON.stringify(api));
      writeFileSync(
        process.env.AOMI_PAYMENT_OPENAPI_FILE,
        JSON.stringify(payment),
      );
    };
    write();
    const combined = JSON.parse(publicApiContract(dir));
    assert.equal(Object.keys(combined.paths).length, 2);
    assert.ok(combined.components.schemas.CreditBalance);
    assert.deepEqual(combined["x-aomi-route-manifest"], [
      "GET /v1/account/credits",
      "POST /v1/agent/chat",
    ]);
    payment.components.schemas.Error = { type: "string" };
    write();
    assert.throws(
      () => publicApiContract(dir),
      /Conflicting public API component/,
    );
    api.paths["/v1/account/credits"] = {};
    write();
    assert.throws(() => publicApiContract(dir), /Duplicate public API path/);
  } finally {
    for (const [i, name] of [
      "AOMI_AGENT_OPENAPI_FILE",
      "AOMI_PAYMENT_OPENAPI_FILE",
    ].entries()) {
      if (original[i] === undefined) delete process.env[name];
      else process.env[name] = original[i];
    }
    rmSync(dir, { recursive: true });
  }
});
