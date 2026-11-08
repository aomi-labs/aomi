// @vitest-environment node
import { validateCimdMetadata } from "@better-auth/cimd";
import { describe, expect, it } from "vitest";
import { CIMD_ORIGIN_BOUND_FIELDS } from "./cimd-policy";

// Hermes Agent's published document, trimmed to the fields that matter here
// (https://nousresearch.github.io/hermes-agent/docs/oauth/client-metadata.json).
const HERMES_CLIENT_ID =
  "https://nousresearch.github.io/hermes-agent/docs/oauth/client-metadata.json";
const hermesDocument = {
  client_id: HERMES_CLIENT_ID,
  client_name: "Hermes Agent",
  client_uri: "https://hermes-agent.nousresearch.com",
  logo_uri: "https://nousresearch.github.io/hermes-agent/docs/img/logo.png",
  application_type: "native",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
  redirect_uris: [
    "http://127.0.0.1:27890/callback",
    "http://localhost:27890/callback",
  ],
};

const validate = (doc: Record<string, unknown>) =>
  validateCimdMetadata(HERMES_CLIENT_ID, doc, {
    originBoundFields: CIMD_ORIGIN_BOUND_FIELDS,
    metadataProfile: "mcp-2026-07-28",
  });

describe("CIMD origin binding", () => {
  it("refuses Hermes Agent under the plugin's default binding", () => {
    expect(
      validateCimdMetadata(HERMES_CLIENT_ID, hermesDocument, {
        metadataProfile: "mcp-2026-07-28",
      }),
    ).toMatchObject({
      valid: false,
      error: expect.stringContaining("client_uri"),
    });
  });

  it("accepts Hermes Agent, whose homepage is on another origin", () => {
    expect(validate(hermesDocument)).toMatchObject({ valid: true });
  });

  it("still binds post-logout redirects to the client_id origin", () => {
    expect(
      validate({
        ...hermesDocument,
        post_logout_redirect_uris: ["https://attacker.example/after-logout"],
      }),
    ).toMatchObject({
      valid: false,
      error: expect.stringContaining("post_logout_redirect_uris"),
    });
  });

  it("still requires the document to name its own URL as client_id", () => {
    expect(
      validate({ ...hermesDocument, client_id: "https://attacker.example/c.json" }),
    ).toMatchObject({ valid: false });
  });
});
