import { describe, expect, it } from "vitest";

import { BackendError, DeployError } from "../src/errors";
import { identifyLaunchError, launchErrorResponse } from "../src/bff/index";
import { RequiredSecretsCheckError } from "../src/bff/release-manifest";

describe("launch error responses", () => {
  it.each([401, 403, 503])(
    "preserves a backend %s response while exposing classification facts",
    async (status) => {
      const error = new BackendError(
        "deploy",
        status,
        `deploy failed (${status})`,
        JSON.stringify({ error: `backend_${status}` }),
      );

      expect(identifyLaunchError(error)).toMatchObject({
        origin: "upstream_response",
        upstream: "rust",
        upstreamStatus: status,
        credential: "service",
        response: { status, error: `backend_${status}` },
      });
      const response = launchErrorResponse(error);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: `backend_${status}`,
      });
    },
  );

  it("preserves invalid-request and required-secret user messages", async () => {
    const invalid = launchErrorResponse(
      new DeployError("INVALID_REQUEST", "invalid release"),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "invalid release",
    });

    const unavailable = launchErrorResponse(new RequiredSecretsCheckError());
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: "Unable to verify required secrets. Try again.",
      code: "required_secrets_github_unavailable",
      retryable: true,
    });

    // The operator-side case is NOT retryable, and says so in the body rather
    // than only in a message a browser would have to pattern-match.
    const misconfigured = launchErrorResponse(
      new RequiredSecretsCheckError({ reason: "bff_misconfigured" }),
    );
    expect(misconfigured.status).toBe(503);
    await expect(misconfigured.json()).resolves.toEqual({
      error:
        "Required secrets cannot be verified: this deployment is missing its GitHub token.",
      code: "required_secrets_bff_misconfigured",
      retryable: false,
    });
  });

  it("carries the Manager's structured deploy_error through to the browser", async () => {
    const deployError = {
      code: "github_app_permission_missing",
      message:
        "The Aomi GitHub App cannot dispatch the deployment workflow on `aomi-labs/community-apps`",
      hint: "Grant the Aomi GitHub App `actions: write` on the platform repository, then retry.",
      retryable: false,
      details: {
        repository: "aomi-labs/community-apps",
        permission: "actions:write",
      },
    };
    const error = new BackendError(
      "deploy",
      502,
      "deploy failed (502)",
      JSON.stringify({
        ok: false,
        error: "GitHub deployment request returned HTTP 403",
        error_code: "github_app_permission_missing",
        deploy_error: deployError,
      }),
    );

    expect(identifyLaunchError(error).response).toEqual({
      status: 502,
      error: "GitHub deployment request returned HTTP 403",
      code: "github_app_permission_missing",
      retryable: false,
      deployError,
    });
    const response = launchErrorResponse(error);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub deployment request returned HTTP 403",
      code: "github_app_permission_missing",
      retryable: false,
      deployError,
    });
  });

  it("leaves an envelope without deploy_error exactly as before", () => {
    const plain = new BackendError(
      "deploy",
      502,
      "deploy failed (502)",
      JSON.stringify({ error: "upstream exploded" }),
    );
    expect(identifyLaunchError(plain).response).toEqual({
      status: 502,
      error: "upstream exploded",
    });

    // `error_code` alone still names the failure; retryability stays unknown
    // (so the browser keeps its Retry) until a deploy_error says otherwise.
    const coded = new BackendError(
      "deploy",
      422,
      "deploy failed (422)",
      JSON.stringify({ error: "bad manifest", error_code: "manifest_invalid" }),
    );
    expect(identifyLaunchError(coded).response).toEqual({
      status: 422,
      error: "bad manifest",
      code: "manifest_invalid",
    });

    const unmarked = new BackendError(
      "deploy",
      502,
      "deploy failed (502)",
      JSON.stringify({
        error: "flaky",
        deploy_error: { code: "github_unreachable", message: "flaky" },
      }),
    );
    expect(identifyLaunchError(unmarked).response).toMatchObject({
      code: "github_unreachable",
      retryable: true,
      deployError: { hint: null, retryable: true, details: {} },
    });
  });

  it("preserves the established unknown-error fallback", async () => {
    const error = new Error("launch setup failed");

    expect(identifyLaunchError(error)).toMatchObject({
      origin: "local",
      response: { status: 502, error: "launch setup failed" },
    });
    const response = launchErrorResponse(error);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "launch setup failed",
    });
  });
});
