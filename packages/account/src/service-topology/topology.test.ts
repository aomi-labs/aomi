// @vitest-environment node
import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  importPKCS8,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { AomiService, parseTopology } from "../topology";

// A self-contained Ed25519 keypair so the test signs and verifies for real,
// no committed keys.
let bffPrivatePem: string;
let toml: string;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    extractable: true,
  });
  const bffPublicPem = await exportSPKI(publicKey);
  bffPrivatePem = await exportPKCS8(privateKey);
  toml = `
[[services]]
name = "aomi-bff"
kid = "aomi-bff-test-1"
issues = ["user", "service"]
audiences = ["aomi-backend"]
public_key = """${bffPublicPem}"""

[[services]]
name = "aomi-backend"
kid = "aomi-backend"
issues = []
audiences = []
public_key = ""

[[services]]
name = "empty-issuer"
kid = "empty-issuer"
issues = []
audiences = ["aomi-backend"]
public_key = """${bffPublicPem}"""
`;
});

const issuer = () =>
  AomiService.fromTopology({
    toml,
    selfName: "aomi-bff",
    privateKeyPem: bffPrivatePem,
  });
const verifier = () =>
  AomiService.fromTopology({ toml, selfName: "aomi-backend" });

describe("AomiService topology", () => {
  it("mints and verifies a service bearer across the topology", async () => {
    const { accessToken } = await issuer().mint({
      role: "service",
      subject: "aomi-bff",
      audience: "aomi-backend",
    });
    const claims = await verifier().verifyRole(accessToken, "service");
    expect(claims.role).toBe("service");
    expect(claims.iss).toBe("aomi-bff");
    expect(claims.aud).toBe("aomi-backend");
    expect(claims.sub).toBe("aomi-bff");
  });

  it("refuses to mint a role the service is not authorized for", async () => {
    await expect(
      issuer().mint({ role: "admin", subject: "x", audience: "aomi-backend" }),
    ).rejects.toThrow(/not authorized to mint role "admin"/);
  });

  it("refuses to mint for an audience it cannot address", async () => {
    await expect(
      issuer().mint({ role: "service", subject: "x", audience: "stranger" }),
    ).rejects.toThrow(/not authorized to address audience "stranger"/);
  });

  it("verifyRole rejects a role mismatch", async () => {
    const { accessToken } = await issuer().mint({
      role: "service",
      subject: "aomi-bff",
      audience: "aomi-backend",
    });
    await expect(verifier().verifyRole(accessToken, "user")).rejects.toThrow(
      /does not satisfy required role "user"/,
    );
  });

  it("fromTopology fails for an unknown self", () => {
    expect(() => AomiService.fromTopology({ toml, selfName: "ghost" })).toThrow(
      /not in the topology/,
    );
  });

  it("parseTopology reads the mesh nodes", () => {
    const mesh = parseTopology(toml);
    expect(mesh.services.map((s) => s.name)).toEqual([
      "aomi-bff",
      "aomi-backend",
      "empty-issuer",
    ]);
    expect(mesh.services[0].issues).toEqual(["user", "service"]);
  });

  it("rejects an issuer node with no public key before importing it", async () => {
    await expect(
      verifier().verify(await bearerWithKid("aomi-backend")),
    ).rejects.toThrow(/has no public key/);
  });

  it("rejects an issuer node with no authorized roles before verification", async () => {
    await expect(
      verifier().verify(await bearerWithKid("empty-issuer")),
    ).rejects.toThrow(/is not authorized to issue bearers/);
  });
});

async function bearerWithKid(kid: string): Promise<string> {
  const privateKey = await importPKCS8(bffPrivatePem, "EdDSA");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "user" })
    .setProtectedHeader({ alg: "EdDSA", kid })
    .setSubject("alice")
    .setIssuer("aomi-bff")
    .setAudience("aomi-backend")
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .sign(privateKey);
}
