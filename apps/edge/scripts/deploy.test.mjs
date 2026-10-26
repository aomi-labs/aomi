import { describe, expect, it } from "vitest";

import { deployArgs, resolveDeployEnvironment } from "./deploy.mjs";

describe("edge deploy script", () => {
  it("passes the inventory origins to wrangler as vars", () => {
    expect(
      deployArgs("staging", {
        BACKEND_ORIGINS: "https://b1.example, https://b2.example",
        API_SERVER_ORIGIN: "https://agent.example",
        PAYMENT_ORIGIN: "https://payment.example",
      }),
    ).toEqual([
      "wrangler",
      "deploy",
      "--env",
      "staging",
      "--var",
      "BACKEND_ORIGINS:https://b1.example, https://b2.example",
      "--var",
      "API_SERVER_ORIGIN:https://agent.example",
      "--var",
      "PAYMENT_ORIGIN:https://payment.example",
    ]);
  });

  it("refuses a deploy without origins or with a non-https origin", () => {
    expect(() => deployArgs("production", {})).toThrow(/BACKEND_ORIGINS must be set/);
    expect(() =>
      deployArgs("production", {
        BACKEND_ORIGINS: "http://b1.example",
        API_SERVER_ORIGIN: "https://agent.example",
      }),
    ).toThrow(/not https/);
    expect(() => resolveDeployEnvironment("preview")).toThrow(/Usage/);
  });
});
