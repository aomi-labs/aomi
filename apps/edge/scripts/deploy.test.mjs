import { describe, expect, it } from "vitest";

import { deployArgs } from "./deploy.mjs";

const staging = {
  EDGE_TOPOLOGY: "staging",
  EDGE_WORKER_NAME: "aomi-edge-staging",
  EDGE_ROUTES: "api-staging.aomi.dev/*, chat-staging.aomi.dev/api/*",
  BACKEND_ORIGINS: "https://b1.example, https://b2.example",
  API_SERVER_ORIGIN: "https://agent.example",
};

describe("edge deploy script", () => {
  it("deploys the one configuration under the environment's name, routes and vars", () => {
    expect(
      deployArgs({
        ...staging,
        PAYMENT_ORIGIN: "https://payment.example",
        PORTAL_UPSTREAM_ORIGIN: "https://chat-portal.vercel.example",
        BUILD_UPSTREAM_ORIGIN: "https://build.vercel.example",
        MANAGER_ORIGIN: "https://manager.example",
        PORTAL_HOSTS: "chat-staging.aomi.dev",
        CORS_ALLOWED_HOST_PATTERNS: "*.aomi.dev,api-staging.aomi.dev",
        TASK_CORS_PUBLIC_ORIGINS: "https://stableops.dev",
        APP_DEPLOY_PLATFORMS: "community",
      }),
    ).toEqual([
      "wrangler",
      "deploy",
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
      "CORS_ALLOWED_HOST_PATTERNS:*.aomi.dev,api-staging.aomi.dev",
      "--var",
      "TASK_CORS_PUBLIC_ORIGINS:https://stableops.dev",
      "--var",
      "APP_DEPLOY_PLATFORMS:community",
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
  });

  it("passes the RC test identity to rc only, and only as a complete set", () => {
    const base = { BACKEND_ORIGINS: "https://b.example", API_SERVER_ORIGIN: "https://a.example" };
    const identity = {
      RC_OIDC_ACCOUNT_ID: "acct-1",
      RC_OIDC_SUBJECT: "repo:o/r:environment:rc",
      RC_OIDC_WORKFLOWS: "o/r/.github/workflows/w.yml@refs/heads/main",
    };
    const args = deployArgs("rc", { ...base, ...identity });
    expect(args).toContain("RC_OIDC_SUBJECT:repo:o/r:environment:rc");
    expect(args).toContain("RC_OIDC_ACCOUNT_ID:acct-1");
    expect(() => deployArgs("production", { ...base, ...identity })).toThrow(/only valid for the rc environment/);
    expect(() => deployArgs("rc", { ...base, RC_OIDC_ACCOUNT_ID: "acct-1" })).toThrow(/must be set together/);
    expect(deployArgs("rc", base).join(" ")).not.toContain("RC_OIDC");
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
