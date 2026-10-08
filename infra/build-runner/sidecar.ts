/**
 * Live-files sidecar for the build-runner image. Serves the generated crate
 * (apps/<app> under the SDK root) over the sandbox's exposed port so the BFF
 * can show Files/file contents while the run works — the microVM's disk is
 * otherwise invisible to the web tier.
 *
 * Runs on Bun (`bun sidecar.ts <sdkRoot>`). Auth rides the official AOMI
 * service-bearer path: every request must carry an `Authorization: Bearer`
 * EdDSA JWT that aomi-bff minted with PORTAL_SERVICE_PRIVATE_KEY (audience
 * "aomi-sidecar", subject = this run's id). The sidecar verifies it against
 * aomi-bff's committed *public* key ($AOMI_SIDECAR_PUBKEY) — the VM holds no
 * secret, and a leaked bearer is short-lived, run-scoped, and rejected by
 * every other audience in the mesh. The exposed port is public and this VM
 * executes agent-generated code, so the browser never talks to this
 * directly; only the BFF does.
 *
 * Routes:
 *   GET /healthz                 → 200 "ok"
 *   GET /tree                    → CrateFileNode[] of apps/$AOMI_SIDECAR_APP
 *   GET /file?path=<rel>         → raw file body (path-jailed, 256 KB cap)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TREE_SKIP = new Set(["target", "node_modules", ".git", "Cargo.lock"]);
const MAX_FILE_BYTES = 256 * 1024;

export type SidecarBearerExpectations = {
  /** aomi-bff's SPKI public key (PEM). Empty = fail closed. */
  publicKeyPem: string;
  /** The run this sidecar belongs to; the bearer's `sub` must match. */
  runId: string;
};

const EXPECTED_ISSUER = "aomi-bff";
const EXPECTED_AUDIENCE = "aomi-sidecar";

function b64urlDecode(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

/**
 * Verify an `Authorization` header value against the expectations. Same JWT
 * convention as `AomiService.verify` (packages/account/src/service-topology),
 * reimplemented on WebCrypto so this file stays dependency-free inside the image.
 */
export async function verifyBearer(
  authorization: string | null,
  expected: SidecarBearerExpectations,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!expected.publicKeyPem.trim() || !expected.runId) return false;
  if (!authorization?.startsWith("Bearer ")) return false;
  const parts = authorization.slice("Bearer ".length).trim().split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
    if (header.alg !== "EdDSA") return false;
    const payload = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
    if (payload.iss !== EXPECTED_ISSUER) return false;
    if (payload.aud !== EXPECTED_AUDIENCE) return false;
    if (payload.sub !== expected.runId) return false;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(expected.publicKeyPem),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

type Node = { path: string; type: "file" | "folder"; children?: Node[] };

function walk(dir: string, rel: string, depth: number): Node[] {
  if (depth > 4) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !TREE_SKIP.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) =>
      a.isDirectory() === b.isDirectory()
        ? a.name.localeCompare(b.name)
        : a.isDirectory()
          ? -1
          : 1,
    )
    .map((e) => {
      const childRel = `${rel}/${e.name}`;
      return e.isDirectory()
        ? {
            path: childRel,
            type: "folder" as const,
            children: walk(path.join(dir, e.name), childRel, depth + 1),
          }
        : { path: childRel, type: "file" as const };
    });
}

declare const Bun: {
  serve(options: {
    port: number;
    hostname: string;
    fetch(req: Request): Promise<Response> | Response;
  }): unknown;
};

if ((import.meta as { main?: boolean }).main) {
  const sdkRoot = process.argv[2] ?? "/workspace/aomi-sdk";
  const app = process.env.AOMI_SIDECAR_APP ?? "";
  const expected: SidecarBearerExpectations = {
    publicKeyPem: process.env.AOMI_SIDECAR_PUBKEY ?? "",
    runId: process.env.AOMI_SIDECAR_RUN_ID ?? "",
  };
  const port = Number(process.env.AOMI_SIDECAR_PORT) || 8722;
  const appDir = path.join(sdkRoot, "apps", app);

  const tree = (): Node[] => {
    if (!app || !existsSync(appDir)) return [];
    return [{ path: app, type: "folder", children: walk(appDir, app, 0) }];
  };

  /** Resolve a display path ("<app>/src/tool.rs") inside the jail, or null. */
  const jailedFile = (relPath: string): string | null => {
    if (!app) return null;
    const prefix = `${app}/`;
    if (relPath !== app && !relPath.startsWith(prefix)) return null;
    const inside = relPath === app ? "" : relPath.slice(prefix.length);
    const resolved = path.resolve(appDir, inside);
    if (resolved !== appDir && !resolved.startsWith(appDir + path.sep)) {
      return null;
    }
    return resolved;
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") return new Response("ok");
      if (!(await verifyBearer(req.headers.get("authorization"), expected))) {
        return json({ error: "forbidden" }, 403);
      }
      if (url.pathname === "/tree") return json(tree());
      if (url.pathname === "/file") {
        const target = jailedFile(url.searchParams.get("path") ?? "");
        if (!target || !existsSync(target)) {
          return json({ error: "not found" }, 404);
        }
        const stats = statSync(target);
        if (!stats.isFile()) return json({ error: "not a file" }, 400);
        if (stats.size > MAX_FILE_BYTES) {
          return json({ error: `file exceeds ${MAX_FILE_BYTES} bytes` }, 413);
        }
        return new Response(readFileSync(target), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      return json({ error: "not found" }, 404);
    },
  });

  console.log(`sidecar serving apps/${app} on :${port}`);
}
