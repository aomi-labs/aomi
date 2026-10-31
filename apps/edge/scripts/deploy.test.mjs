// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";

import { describe, expect, it } from "vitest";

import { deployArgs, deployConfig } from "./deploy.mjs";

const staging = {
  EDGE_TOPOLOGY: "staging",
  EDGE_WORKER_NAME: "aomi-edge-staging",
  EDGE_ROUTES: "api-staging.aomi.dev/*, chat-staging.aomi.dev/api/*",
  BACKEND_ORIGINS: "https://b1.example, https://b2.example",
  API_SERVER_ORIGIN: "https://agent.example",
};

describe("edge deploy script", () => {
  it("passes provider settings to the deployed Worker", () => {
    const providers = {
      PRIVY_APP_ID: "privy-fixture",
      PARA_JWT_AUDIENCE: "para-fixture",
      PARA_JWKS_URL: "https://para.example/.well-known/jwks.json",
      PARA_API_BASE_URL: "https://para.example",
    };
    const args = deployArgs({ ...staging, ...providers });
    for (const [name, value] of Object.entries(providers)) {
      expect(args).toContain(`${name}:${value}`);
    }
  });

  it("deploys the one configuration under the environment's name, routes and vars", () => {
    expect(
      deployArgs({
        ...staging,
        PAYMENT_ORIGIN: "https://payment.example",
        PORTAL_UPSTREAM_ORIGIN: "https://chat-portal.vercel.example",
        BUILD_UPSTREAM_ORIGIN: "https://build.vercel.example",
        MANAGER_ORIGIN: "https://manager.example",
        PORTAL_HOSTS: "chat-staging.aomi.dev",
        BETTER_AUTH_URL: "https://chat-staging.aomi.dev",
        EDGE_HYPERDRIVE_ID: "9b2f30980123456789abcdef01234567",
        CORS_ALLOWED_HOST_PATTERNS: "*.aomi.dev,api-staging.aomi.dev",
        TASK_CORS_PUBLIC_ORIGINS: "https://stableops.dev",
        BUILD_DEFAULT_PLATFORM: "community",
      }),
    ).toEqual([
      "wrangler",
      "deploy",
      "--config",
      "wrangler.deploy.jsonc",
      "--env",
      "",
      "--name",
      "aomi-edge-staging",
      "--route",
      "api-staging.aomi.dev/*",
      "--route",
      "chat-staging.aomi.dev/api/*",
      "--var",
      "EDGE_TOPOLOGY:staging",
      "--var",
      "BACKEND_ORIGINS:https://b1.example, https://b2.example",
      "--var",
      "API_SERVER_ORIGIN:https://agent.example",
      "--var",
      "PAYMENT_ORIGIN:https://payment.example",
      "--var",
      "PORTAL_UPSTREAM_ORIGIN:https://chat-portal.vercel.example",
      "--var",
      "BUILD_UPSTREAM_ORIGIN:https://build.vercel.example",
      "--var",
      "MANAGER_ORIGIN:https://manager.example",
      "--var",
      "PORTAL_HOSTS:chat-staging.aomi.dev",
      "--var",
      "BETTER_AUTH_URL:https://chat-staging.aomi.dev",
      "--var",
      "CORS_ALLOWED_HOST_PATTERNS:*.aomi.dev,api-staging.aomi.dev",
      "--var",
      "TASK_CORS_PUBLIC_ORIGINS:https://stableops.dev",
      "--var",
      "BUILD_DEFAULT_PLATFORM:community",
    ]);
  });

  it("leaves unset settings to the Worker's defaults", () => {
    const args = deployArgs({ ...staging, PORTAL_HOSTS: "  ", BUILD_HOSTS: "" });
    expect(args.join(" ")).not.toMatch(/PORTAL_HOSTS|BUILD_HOSTS|MANAGER_ORIGIN/);
  });

  it("refuses a deploy without its environment record or with a non-https origin", () => {
    expect(() => deployArgs({})).toThrow(/EDGE_TOPOLOGY must be set/);
    expect(() => deployArgs({ ...staging, EDGE_TOPOLOGY: "preview" })).toThrow(/must be one of/);
    expect(() => deployArgs({ ...staging, EDGE_WORKER_NAME: "" })).toThrow(/EDGE_WORKER_NAME must be set/);
    expect(() => deployArgs({ ...staging, EDGE_ROUTES: " , " })).toThrow(/at least one route/);
    expect(() => deployArgs({ ...staging, EDGE_ROUTES: "https://api.aomi.dev/*" })).toThrow(/not a route pattern/);
    expect(() => deployArgs({ ...staging, BACKEND_ORIGINS: "" })).toThrow(/BACKEND_ORIGINS must be set/);
    expect(() => deployArgs({ ...staging, BACKEND_ORIGINS: "http://b1.example" })).toThrow(/not https/);
    expect(() => deployArgs({ ...staging, MANAGER_ORIGIN: "http://manager.example" })).toThrow(/not https/);
    expect(() => deployArgs({ ...staging, PORTAL_HOSTS: "chat-staging.aomi.dev" })).toThrow(/EDGE_HYPERDRIVE_ID must be set/);
    expect(() => deployArgs({ ...staging, LANDING_HOSTS: "aomi.dev" })).toThrow(/LANDING_UPSTREAM_ORIGIN must be set/);
  });

  it("binds the environment's Hyperdrive config, or none where no portal runs", () => {
    const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const parse = (text) => ts.parseConfigFileTextToJson("wrangler.jsonc", text).config;
    const id = "9b2f30980123456789abcdef01234567";
    expect(parse(deployConfig(source, id)).hyperdrive).toEqual([{ binding: "HYPERDRIVE", id }]);
    expect(parse(deployConfig(source, "")).hyperdrive).toBeUndefined();
    expect(() => deployConfig(source, "local; rm -rf")).toThrow(/not a Hyperdrive config id/);
    const rc = readFileSync(new URL("../wrangler.rc.jsonc", import.meta.url), "utf8");
    expect(deployConfig(rc, "")).toBe(rc);
    expect(() => deployConfig(rc, id)).toThrow(/no Hyperdrive binding/);
  });

  it("passes the RC test identity to the rc topology only, and only as a complete set", () => {
    const rc = { ...staging, EDGE_TOPOLOGY: "rc", EDGE_WORKER_NAME: "aomi-edge-rc", EDGE_ROUTES: "api-rc.aomi.dev/*" };
    const identity = {
      RC_OIDC_ACCOUNT_ID: "acct-1",
      RC_OIDC_SUBJECT: "repo:o/r:environment:rc",
      RC_OIDC_WORKFLOWS: "o/r/.github/workflows/w.yml@refs/heads/main",
    };
    const args = deployArgs({ ...rc, ...identity });
    expect(args).toContain("RC_OIDC_SUBJECT:repo:o/r:environment:rc");
    expect(args).toContain("RC_OIDC_ACCOUNT_ID:acct-1");
    expect(() => deployArgs({ ...staging, ...identity })).toThrow(/only valid for the rc topology/);
    expect(() => deployArgs({ ...rc, RC_OIDC_ACCOUNT_ID: "acct-1" })).toThrow(/must be set together/);
    expect(deployArgs(rc).join(" ")).not.toContain("RC_OIDC");
  });
});

// RC has only a binding/migration overlay. Any shared setting change must land
// in both files; deployment runs these tests before publishing the Worker.
it("keeps the RC overlay equal to the shared config and migrations RC-only", () => {
  const read = (name) => ts.parseConfigFileTextToJson(name, readFileSync(new URL(`../${name}`, import.meta.url), "utf8")).config;
  const shared = read("wrangler.jsonc");
  const { durable_objects, migrations, ...rc } = read("wrangler.rc.jsonc");
  // rc runs no portal, so it leaves out the account database and the placement next to it.
  const { hyperdrive, placement, ...base } = shared;
  expect(rc).toEqual(base);
  expect(shared.durable_objects).toBeUndefined();
  expect(shared.migrations).toBeUndefined();
  expect(durable_objects.bindings).toEqual([{ name: "RC_OIDC_REPLAY", class_name: "RcReplayStore" }]);
  expect(migrations).toEqual([{ tag: "rc-replay-1", new_sqlite_classes: ["RcReplayStore"] }]);
});
