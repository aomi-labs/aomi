import assert from "node:assert/strict";
import test from "node:test";
import { artifactFixtureEnvironment } from "../../scripts/test-start-artifacts.mjs";

test("artifact workflows cannot inherit provider, deployment or live database credentials", () => {
  const env = artifactFixtureEnvironment({
    PATH: "/fixture/bin",
    AOMI_ARTIFACT_SECRET_CANARY: "throwaway-private-canary",
    ANTHROPIC_API_KEY: "must-not-inherit",
    OPENAI_API_KEY: "must-not-inherit",
    OPENROUTER_API_KEY: "must-not-inherit",
    VERCEL_TOKEN: "must-not-inherit",
    VERCEL: "1",
    VERCEL_ENV: "production",
    GH_TOKEN: "must-not-inherit",
    DATABASE_URL: "must-not-inherit",
    SMITHER_DATABASE_URL: "must-not-inherit",
    AOMI_BUILD_RUNNER: "vercel-sandbox",
    AOMI_ALLOW_STALE_SDK: "1",
    NODE_OPTIONS: "must-not-inherit",
    NODE_PATH: "must-not-inherit",
  });
  assert.equal(env.PATH, "/fixture/bin");
  assert.equal(env.AOMI_ARTIFACT_SECRET_CANARY, "throwaway-private-canary");
  assert.equal(env.AOMI_BUILD_RUNNER, "local");
  assert.equal(env.AOMI_ALLOW_STALE_SDK, "0");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.SENTRY_ENABLED, "0");
  assert.ok(!Object.values(env).includes("must-not-inherit"));
  assert.equal(Object.keys(env).length, 6);
});
