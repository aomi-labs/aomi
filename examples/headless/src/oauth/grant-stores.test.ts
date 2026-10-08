import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AomiOAuthGrant } from "@aomi-labs/client";
import { describe, expect, it, vi } from "vitest";

import {
  createJsonFileGrantStore,
  createSecretGrantStore,
  decodeGrantSnapshot,
} from "./grant-stores";

const grant: AomiOAuthGrant = {
  issuer: "https://chat.aomi.dev/api/auth",
  clientId: "managed-client",
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: 2_000_000_000_000,
  resource: "https://chat.aomi.dev/v1/agent",
  scopes: ["agent:read"],
};

describe("OAuth example grant stores", () => {
  it("atomically round-trips an owner-only local snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aomi-oauth-"));
    const path = join(directory, "nested", "grants.json");
    const store = createJsonFileGrantStore(path);

    try {
      await expect(store.load()).resolves.toEqual([]);
      await store.save([grant]);

      await expect(store.load()).resolves.toEqual([grant]);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
        version: 1,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("adapts a host-owned secret service and clears empty snapshots", async () => {
    let value: string | null = null;
    const write = vi.fn(async (next: string | null) => {
      value = next;
    });
    const store = createSecretGrantStore({ read: async () => value, write });

    await store.save([grant]);
    await expect(store.load()).resolves.toEqual([grant]);
    await store.save([]);

    expect(write).toHaveBeenLastCalledWith(null);
  });

  it("rejects malformed and non-persistable grants", () => {
    expect(() => decodeGrantSnapshot('{"version":1,"grants":[{}]}')).toThrow(
      "Invalid Aomi OAuth grant snapshot",
    );
    expect(() =>
      decodeGrantSnapshot(
        JSON.stringify({
          version: 1,
          grants: [{ ...grant, tokenType: "DPoP" }],
        }),
      ),
    ).toThrow("Invalid Aomi OAuth grant snapshot");
  });
});
