import { describe, expect, it } from "vitest";

import { BackendError, DeployError } from "../errors";
import { identifyLaunchError } from "./errors";
import { RequiredSecretsCheckError } from "./release-manifest";

describe("identifyLaunchError", () => {
  it.each([401, 403, 503])(
    "preserves a backend %s response while exposing classification facts",
    (status) => {
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
    },
  );

  it("preserves invalid-request and required-secret user messages", () => {
    expect(
      identifyLaunchError(new DeployError("INVALID_REQUEST", "invalid release"))
        .response,
    ).toEqual({ status: 400, error: "invalid release" });

    expect(identifyLaunchError(new RequiredSecretsCheckError()).response).toEqual({
      status: 503,
      error: "Unable to verify required secrets. Try again.",
      code: "required_secrets_github_unavailable",
      retryable: true,
    });

    // The operator-side case is NOT retryable, and says so in the body rather
    // than only in a message a browser would have to pattern-match.
    expect(
      identifyLaunchError(
        new RequiredSecretsCheckError({ reason: "bff_misconfigured" }),
      ).response,
    ).toEqual({
      status: 503,
      error:
        "Required secrets cannot be verified: this deployment is missing its GitHub token.",
      code: "required_secrets_bff_misconfigured",
      retryable: false,
    });
  });

  it("carries the Manager's structured deploy_error through to the browser", () => {
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
    const publicDeployError = {
      code: deployError.code,
      hint: deployError.hint,
      retryable: false,
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
      deployError: publicDeployError,
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
      deployError: {
        code: "github_unreachable",
        hint: null,
        retryable: true,
      },
    });
  });

  it("never exposes an unexpected error's message", () => {
    expect(
      identifyLaunchError(new Error("connect ECONNREFUSED 10.0.0.4:5432")),
    ).toMatchObject({
      origin: "local",
      response: { status: 500, error: "internal_error" },
    });
  });
});
