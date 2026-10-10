import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyBearer } from "../../../../../../infra/build-runner/sidecar";
import { sidecarVerifierPublicKeyPem } from "./sidecar-auth";

const mocks = vi.hoisted(() => ({
  portalService: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@aomi-labs/account/server", () => ({
  portalService: mocks.portalService,
}));

vi.mock("@/server/bff/failures", () => ({
  buildFailures: {
    handle: (input: { error: unknown; context: Record<string, unknown> }) =>
      mocks.capture(input.error, { ...input.context, status: 500 }),
  },
}));

beforeEach(() => {
  mocks.portalService.mockReset();
  mocks.capture.mockReset();
});

/**
 * Round-trips the official service-bearer convention against the in-VM
 * verifier: sign an EdDSA JWT exactly the way `AomiService.mint` does
 * (jose `SignJWT`, alg EdDSA over `header.payload`) and check the sidecar's
 * dependency-free WebCrypto verification accepts it — and rejects every
 * tampered variant.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

const RUN_ID = "smither-my-app-0db9a0f6-0000-0000-0000-000000000000";

const b64url = (data: Buffer | string) =>
  Buffer.from(data).toString("base64url");

function mintJwt(
  claims: Record<string, unknown>,
  key: typeof privateKey = privateKey,
): string {
  const header = b64url(
    JSON.stringify({ alg: "EdDSA", kid: "aomi-bff-dev-1" }),
  );
  const payload = b64url(JSON.stringify(claims));
  const signature = edSign(null, Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(signature)}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    role: "service",
    sub: RUN_ID,
    iss: "aomi-bff",
    aud: "aomi-sidecar",
    iat: now,
    exp: now + 300,
    ...overrides,
  };
}

const expected = { publicKeyPem, runId: RUN_ID };

describe("verifyBearer", () => {
  it("accepts a well-formed bearer for this run", async () => {
    const jwt = mintJwt(claims());
    expect(await verifyBearer(`Bearer ${jwt}`, expected)).toBe(true);
  });

  it("rejects wrong audience, issuer, subject, and expiry", async () => {
    for (const bad of [
      claims({ aud: "aomi-backend" }),
      claims({ iss: "aomi-admin" }),
      claims({ sub: "smither-other-run" }),
      claims({ exp: Math.floor(Date.now() / 1000) - 10 }),
    ]) {
      expect(await verifyBearer(`Bearer ${mintJwt(bad)}`, expected)).toBe(
        false,
      );
    }
  });

  it("rejects signatures from a different key", async () => {
    const jwt = mintJwt(claims(), otherKeys.privateKey);
    expect(await verifyBearer(`Bearer ${jwt}`, expected)).toBe(false);
  });

  it("rejects tampered payloads", async () => {
    const [h, , s] = mintJwt(claims()).split(".");
    const forged = `${h}.${b64url(JSON.stringify(claims({ sub: RUN_ID })))}x.${s}`;
    expect(await verifyBearer(`Bearer ${forged}`, expected)).toBe(false);
  });

  it("fails closed on missing config or malformed headers", async () => {
    const jwt = mintJwt(claims());
    expect(
      await verifyBearer(`Bearer ${jwt}`, { publicKeyPem: "", runId: RUN_ID }),
    ).toBe(false);
    expect(
      await verifyBearer(`Bearer ${jwt}`, { publicKeyPem, runId: "" }),
    ).toBe(false);
    expect(await verifyBearer(null, expected)).toBe(false);
    expect(await verifyBearer("Bearer not.a.jwt", expected)).toBe(false);
    expect(await verifyBearer(jwt, expected)).toBe(false);
  });
});

describe("sidecar verifier configuration", () => {
  it("captures a topology failure and still fails closed", () => {
    const error = new Error("private topology path");
    mocks.portalService.mockImplementation(() => {
      throw error;
    });

    expect(sidecarVerifierPublicKeyPem()).toBe("");
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build",
      operation: "build.sidecar_verifier_config",
      status: 500,
    });
  });
});
