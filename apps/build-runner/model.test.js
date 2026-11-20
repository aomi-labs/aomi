import assert from "node:assert/strict";
import test from "node:test";
import { modelRequest } from "./model.js";

const run = { input: { builder: "claude" }, modelCapability: "fixture-run", expires: Date.now() + 60000, status: "running" };
const request = (path, key = run.modelCapability) => new Request("http://model.internal" + path, {
  method: "POST", headers: { authorization: "Bearer " + key },
});
test("a model capability is limited to the active run and its provider", async () => {
  for (const [candidate, req] of [
    [{ ...run, expires: 1 }, request("/v1/messages")],
    [{ ...run, status: "completed" }, request("/v1/messages")],
    [run, request("/v1/messages", "another-run")],
    [run, request("/v1/responses")],
    [run, request("/api/keys")],
  ]) {
    assert.equal((await modelRequest(req, {}, candidate, assert.fail)).status, 403);
  }
});
test("the Worker attaches the provider key only to its fixed inference endpoint", async () => {
  const result = await modelRequest(request("/v1/messages"), { OPENROUTER_API_KEY: "provider-fixture" }, run, (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/messages");
    assert.equal(init.headers.get("authorization"), "Bearer provider-fixture");
    assert.equal(init.redirect, "manual");
    return new Response("stream");
  });
  assert.equal(await result.text(), "stream");
});

test("the Worker refuses a provider redirect without forwarding its location", async () => {
  let calls = 0;
  const result = await modelRequest(request("/v1/messages"), { OPENROUTER_API_KEY: "provider-fixture" }, run, (url, init) => {
    calls += 1;
    assert.equal(url, "https://openrouter.ai/api/v1/messages");
    assert.equal(init.redirect, "manual");
    return Response.redirect("https://example.com/redirected", 307);
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 502);
  assert.equal(result.headers.get("location"), null);
});
