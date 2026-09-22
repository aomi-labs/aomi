import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createDeviceAuthGrantService,
  type DeviceAuthRecordStore,
} from "./grants";

class MemoryRecordStore implements DeviceAuthRecordStore {
  readonly records = new Map<string, { value: string; expiresAt: number }>();

  async write(input: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<void> {
    this.records.set(input.identifier, {
      value: input.value,
      expiresAt: input.expiresAt.getTime(),
    });
  }

  async consume(input: {
    identifier: string;
    now: Date;
  }): Promise<string | null> {
    const record = this.records.get(input.identifier);
    if (!record || record.expiresAt <= input.now.getTime()) return null;
    this.records.delete(input.identifier);
    return record.value;
  }

  async replace<Result>(input: {
    identifier: string;
    now: Date;
    replacement(value: string): {
      identifier: string;
      value: string;
      expiresAt: Date;
      result: Result;
    };
  }): Promise<Result | null> {
    const record = this.records.get(input.identifier);
    if (!record || record.expiresAt <= input.now.getTime()) return null;
    const replacement = input.replacement(record.value);
    this.records.set(replacement.identifier, {
      value: replacement.value,
      expiresAt: replacement.expiresAt.getTime(),
    });
    this.records.delete(input.identifier);
    return replacement.result;
  }

  identifier(suffix: string): string {
    const entry = [...this.records.keys()].find((key) => key.includes(suffix));
    if (!entry) throw new Error(`missing ${suffix} record`);
    return entry;
  }
}

const secret = "test-better-auth-secret-at-least-32-bytes";
const state = "state_1234567890abcdef";
const redirectUri = "http://127.0.0.1:49152/callback";
const verifier = "verifier-123";
const codeChallenge = sha256Base64Url(verifier);

function service(
  store = new MemoryRecordStore(),
  now: () => number = () => Date.now(),
  serviceSecret = secret,
) {
  return {
    store,
    grants: createDeviceAuthGrantService({
      secret: serviceSecret,
      store,
      now,
    }),
  };
}

describe("database-backed device auth grants", () => {
  it("rejects identifier namespaces that could widen expiry cleanup", () => {
    expect(() =>
      createDeviceAuthGrantService({
        secret,
        store: new MemoryRecordStore(),
        identifierPrefix: "aomi:device-auth:test%:",
      }),
    ).toThrow("invalid_device_auth_identifier_prefix");
  });

  it("exchanges a valid encrypted grant once across service instances", async () => {
    const store = new MemoryRecordStore();
    const issuer = service(store).grants;
    const exchanger = service(store).grants;
    const grant = await issuer.issueDeviceAuthGrant({
      state,
      codeChallenge,
      redirectUri,
      sessionToken: "session-token",
      expiresAt: "2031-01-01T00:00:00.000Z",
      betterAuthUserId: "better-auth-user",
      provider: "privy",
    });

    expect([...store.records.values()][0]?.value).not.toContain(
      "session-token",
    );
    await expect(
      exchanger.exchangeDeviceAuthGrant({
        code: grant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toMatchObject({
      sessionToken: "session-token",
      betterAuthUserId: "better-auth-user",
      provider: "privy",
    });
    await expect(
      issuer.exchangeDeviceAuthGrant({
        code: grant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toBeNull();
  });

  it("rejects expired and tampered encrypted records", async () => {
    let timestamp = 1_000_000;
    const expired = service(new MemoryRecordStore(), () => timestamp);
    const grant = await expired.grants.issueDeviceAuthGrant({
      state,
      codeChallenge,
      redirectUri,
      sessionToken: "session-token",
      expiresAt: null,
      provider: "para",
    });
    timestamp += 5 * 60 * 1000 + 1;
    await expect(
      expired.grants.exchangeDeviceAuthGrant({
        code: grant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toBeNull();

    const tampered = service();
    const tamperedGrant = await tampered.grants.issueDeviceAuthGrant({
      state,
      codeChallenge,
      redirectUri,
      sessionToken: "session-token",
      expiresAt: null,
      provider: "para",
    });
    const identifier = tampered.store.identifier("grant:");
    const record = tampered.store.records.get(identifier)!;
    const envelope = record.value.split(".");
    const tag = envelope[3]!;
    envelope[3] = `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`;
    tampered.store.records.set(identifier, {
      ...record,
      value: envelope.join("."),
    });
    await expect(
      tampered.grants.exchangeDeviceAuthGrant({
        code: tamperedGrant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toBeNull();
  });

  it.each([
    ["state", { state: "different_1234567890" }],
    ["redirect", { redirectUri: "http://127.0.0.1:49153/callback" }],
    ["PKCE", { codeVerifier: "wrong-verifier" }],
  ])("consumes a grant rejected for the wrong %s", async (_name, changed) => {
    const { grants } = service();
    const grant = await grants.issueDeviceAuthGrant({
      state,
      codeChallenge,
      redirectUri,
      sessionToken: "session-token",
      expiresAt: null,
      provider: "para",
    });
    const request = {
      code: grant.code,
      state,
      codeVerifier: verifier,
      redirectUri,
      ...changed,
    };
    await expect(grants.exchangeDeviceAuthGrant(request)).resolves.toBeNull();
    await expect(
      grants.exchangeDeviceAuthGrant({
        code: grant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toBeNull();
  });

  it("binds link intent state, provider, redirect, and PKCE across instances", async () => {
    const store = new MemoryRecordStore();
    const issuer = service(store).grants;
    const exchanger = service(store).grants;
    const intent = await issuer.issueDeviceAuthLinkIntent({
      state,
      codeChallenge,
      redirectUri,
      betterAuthUserId: "better-auth-user",
      provider: "privy",
    });
    const credential = {
      provider: "privy",
      tokenKind: "identity_token",
      providerToken: "provider-token",
    };
    const grant = await exchanger.issueDeviceAuthLinkGrant({
      linkIntent: intent.id,
      state,
      redirectUri,
      provider: "privy",
      credential,
    });
    expect([...store.records.values()][0]?.value).not.toContain(
      "provider-token",
    );

    await expect(
      issuer.exchangeDeviceAuthGrant({
        code: grant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toMatchObject({
      purpose: "link",
      betterAuthUserId: "better-auth-user",
      provider: "privy",
      credential,
    });
  });

  it.each([
    ["state", { state: "different_1234567890" }],
    ["provider", { provider: "para" as const }],
    ["redirect", { redirectUri: "http://127.0.0.1:49153/callback" }],
  ])("rejects a link grant with the wrong %s", async (_name, changed) => {
    const { grants } = service();
    const intent = await grants.issueDeviceAuthLinkIntent({
      state,
      codeChallenge,
      redirectUri,
      betterAuthUserId: "better-auth-user",
      provider: "privy",
    });
    await expect(
      grants.issueDeviceAuthLinkGrant({
        linkIntent: intent.id,
        state,
        redirectUri,
        provider: "privy",
        credential: { provider: "privy" },
        ...changed,
      }),
    ).rejects.toThrow("invalid_link_intent");

    await expect(
      grants.issueDeviceAuthLinkGrant({
        linkIntent: intent.id,
        state,
        redirectUri,
        provider: "privy",
        credential: { provider: "privy" },
      }),
    ).resolves.toMatchObject({ purpose: "link", provider: "privy" });
  });

  it("rejects records encrypted under another deployment secret", async () => {
    const store = new MemoryRecordStore();
    const issuer = service(store).grants;
    const grant = await issuer.issueDeviceAuthGrant({
      state,
      codeChallenge,
      redirectUri,
      sessionToken: "session-token",
      expiresAt: null,
      provider: "para",
    });
    const otherProcess = service(
      store,
      () => Date.now(),
      "different-better-auth-secret-at-least-32-bytes",
    ).grants;
    await expect(
      otherProcess.exchangeDeviceAuthGrant({
        code: grant.code,
        state,
        codeVerifier: verifier,
        redirectUri,
      }),
    ).resolves.toBeNull();
  });

  it("rejects non-loopback and non-callback redirects", async () => {
    const { grants } = service();
    await expect(
      grants.issueDeviceAuthGrant({
        state,
        codeChallenge,
        redirectUri: "https://example.com/callback",
        sessionToken: "session-token",
        expiresAt: null,
        provider: "para",
      }),
    ).rejects.toThrow("invalid_redirect_uri");
    await expect(
      grants.issueDeviceAuthGrant({
        state,
        codeChallenge,
        redirectUri: "http://127.0.0.1:49152/not-callback",
        sessionToken: "session-token",
        expiresAt: null,
        provider: "para",
      }),
    ).rejects.toThrow("invalid_redirect_uri");
  });
});

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
