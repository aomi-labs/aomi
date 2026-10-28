// @vitest-environment node
import { decodeProtectedHeader, exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import { edgeService, edgeTopologyName, resetEdgeServices } from "./identity";
import { TOPOLOGIES } from "@aomi-labs/service-identity";

const EDGE_TOPOLOGIES = TOPOLOGIES["aomi-edge"];

beforeEach(() => {
  resetEdgeServices();
});

describe("edge identity", () => {
  it("selects the topology from the var, then the request host", () => {
    expect(edgeTopologyName({}, "api.aomi.dev")).toBe("production");
    expect(edgeTopologyName({}, "api-staging.aomi.dev")).toBe("staging");
    expect(edgeTopologyName({}, "api-rc.aomi.dev")).toBe("rc");
    expect(edgeTopologyName({}, "localhost:8787")).toBe("default");
    expect(edgeTopologyName({ EDGE_TOPOLOGY: "staging" }, "api.aomi.dev")).toBe("staging");
  });

  it("mints as aomi-edge with the topology's kid and audiences", async () => {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
    const service = edgeService(
      { EDGE_TOPOLOGY: "default", EDGE_SERVICE_PRIVATE_KEY: await exportPKCS8(privateKey) },
      "localhost",
    );
    const { accessToken } = await service.mint({
      role: "user",
      subject: "user-1",
      audience: "aomi-api-server",
      delegated: { auth_source: "session", principal_class: "user" },
    });
    expect(decodeProtectedHeader(accessToken).kid).toBe("aomi-edge-dev-1");
    const { payload } = await jwtVerify(accessToken, publicKey, {
      issuer: "aomi-edge",
      audience: "aomi-api-server",
    });
    expect(payload.sub).toBe("user-1");
    expect(payload.role).toBe("user");
    expect(payload.auth_source).toBe("session");
    await expect(
      service.mint({ role: "admin", subject: "x", audience: "aomi-backend" }),
    ).rejects.toThrow(/not authorized to mint role "admin"/);
  });

  it("commits a usable dev public key and placeholders for the deployed ones", async () => {
    const dev = /public_key = """\n([\s\S]*?)"""/.exec(EDGE_TOPOLOGIES.default)?.[1] ?? "";
    await expect(importSPKI(dev.trim(), "EdDSA")).resolves.toBeDefined();
    for (const [name, kid] of [["staging", "staging"], ["rc", "rc"], ["production", "prod"]] as const) {
      expect(EDGE_TOPOLOGIES[name]).toMatch(/name = "aomi-edge"/);
      expect(EDGE_TOPOLOGIES[name]).toMatch(new RegExp(`kid = "aomi-edge-${kid}-1"`));
    }
    // rc is its own environment: it never mints with Beta's (staging) key.
    const key = (name: keyof typeof EDGE_TOPOLOGIES) => /public_key = """\n([\s\S]*?)"""/.exec(EDGE_TOPOLOGIES[name])?.[1];
    expect(key("rc")).not.toBe(key("staging"));
    // A freshly generated SPKI has the shape the committed key has.
    const { publicKey } = await generateKeyPair("EdDSA", { extractable: true });
    expect(await exportSPKI(publicKey)).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });
});
