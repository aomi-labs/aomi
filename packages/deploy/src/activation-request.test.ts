import { describe, expect, it } from "vitest";

import {
  buildActivationRequest,
  buildActivationRequestDiscordBody,
} from "../src/activation-request";

const INPUT = {
  email: "alice@gmail.com",
  githubAccount: "alice-git-acc",
  app: "cecilia-test-2",
  platform: "community",
  repo: "aomi-labs/community-apps",
  requestedAt: "2026-06-03T08:01:38Z",
};

describe("buildActivationRequest", () => {
  it("emits the canonical snake_case payload (matches aomi-git)", () => {
    expect(buildActivationRequest(INPUT)).toEqual({
      kind: "activation_request",
      email: "alice@gmail.com",
      github_account: "alice-git-acc",
      app: "cecilia-test-2",
      platform: "community",
      repo: "aomi-labs/community-apps",
      requested_at: "2026-06-03T08:01:38Z",
      source: "@aomi-labs/deploy/0.1.0",
    });
  });

  it("never carries a token or release artifacts (pre-deploy)", () => {
    const p = buildActivationRequest(INPUT) as Record<string, unknown>;
    expect(p.token).toBeUndefined();
    expect(p.activation_token).toBeUndefined();
    expect(p.app_release_tag).toBeUndefined();
    expect(p.server_tags).toBeUndefined();
  });

  it("defaults requested_at to an RFC3339 Z timestamp", () => {
    const { requested_at } = buildActivationRequest({ ...INPUT, requestedAt: undefined });
    expect(requested_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("rejects a malformed email", () => {
    expect(() => buildActivationRequest({ ...INPUT, email: "not-an-email" })).toThrowError(/email/);
  });

  it("rejects empty required fields", () => {
    expect(() => buildActivationRequest({ ...INPUT, githubAccount: "  " })).toThrowError(/githubAccount/);
  });
});

describe("buildActivationRequestDiscordBody", () => {
  it("builds an embed whose fields mirror the payload", () => {
    const body = buildActivationRequestDiscordBody(INPUT, { opsMention: "<@&123>" });
    expect(body.content).toBe("<@&123>");
    expect(body.allowed_mentions).toEqual({ parse: ["users", "roles"] });
    expect(body.allowed_mentions.parse).not.toContain("everyone");

    const embed = body.embeds[0];
    expect(embed.title).toBe("Activation request");
    const values = embed.fields.map((f) => f.value);
    expect(values).toContain("alice@gmail.com");
    expect(values).toContain("alice-git-acc");
    expect(values).toContain("aomi-labs/community-apps");
  });

  it("inlines the canonical payload as a fenced json block that round-trips", () => {
    const { description } = buildActivationRequestDiscordBody(INPUT).embeds[0];
    expect(description.startsWith("```json\n")).toBe(true);
    expect(description.endsWith("\n```")).toBe(true);
    const inner = description.slice("```json\n".length, -"\n```".length);
    const parsed = JSON.parse(inner);
    expect(parsed.kind).toBe("activation_request");
    expect(parsed.github_account).toBe("alice-git-acc");
    expect(parsed.repo).toBe("aomi-labs/community-apps");
  });

  it("defaults content to empty when no ops mention is given", () => {
    expect(buildActivationRequestDiscordBody(INPUT).content).toBe("");
  });
});
