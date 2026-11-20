import { Buffer } from "node:buffer";
import { Container } from "@cloudflare/containers";
import { extractFileFromTarGz } from "../build/src/server/build/tar.ts";
import { modelRequest } from "./model.js";

export { ContainerProxy } from "@cloudflare/containers";

// Smithers limits its base64 crate archive to 2,500,000 characters.
const MAX_ARTIFACT_BYTES = 2_000_000;

// R2 requires a known length. Buffer at most the runner's small crate archive.
async function readArtifact(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARTIFACT_BYTES) {
        await reader.cancel();
        throw new Error("Build artifact exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Build artifact is empty");
  return Buffer.concat(chunks, size);
}

// This Worker has only a private service binding. The caller authenticates the owner.
export default {
  async fetch(request, env) {
    const owner = request.headers.get("x-aomi-build-owner");
    if (!owner) return new Response(null, { status: 401 });
    const { pathname } = new URL(request.url);
    const create = pathname === "/runs" && request.method === "POST";
    const match = /^\/runs\/([0-9a-f-]{36})(\/artifact|\/file)?$/.exec(pathname);
    if (!create && !match) return new Response(null, { status: 404 });
    const id = create ? crypto.randomUUID() : match[1];
    const run = env.RUNS.getByName(JSON.stringify([owner, id]));
    const path = create ? "/start" : (match[2] ?? "/status") + new URL(request.url).search;
    return run.fetch(new Request("https://run.internal" + path, {
      method: request.method, headers: { "x-run-id": id }, body: request.body,
    }));
  },
};

export class BuildRun extends Container {
  async model(request) {
    return modelRequest(request, this.env, await this.ctx.storage.get("run"));
  }
  defaultPort = 8080;
  sleepAfter = "5m";

  async fetch(request) {
    const path = new URL(request.url).pathname;
    let run = await this.ctx.storage.get("run");
    if (!run && path === "/start" && request.method === "POST") {
      const input = await request.json().catch(() => null);
      if (input && typeof input.prompt === "string") {
        input.app ??= input.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean).slice(0, 5).join("-").slice(0, 64) || "aomi-app";
        input.builder ??= "claude";
      }
      if (!input || typeof input.app !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.app) ||
          typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 4000 ||
          !["none", "claude", "codex"].includes(input.builder)) return new Response(null, { status: 400 });
      run = { id: request.headers.get("x-run-id"), input, status: "running",
        createdAt: new Date().toISOString(), capability: crypto.randomUUID(), modelCapability: crypto.randomUUID(), expires: Date.now() + 30 * 60_000, attempts: 0 };
      await this.schedule(1, "supervise");
      await this.ctx.storage.put("run", run);
    }
    if (!run) return new Response(null, { status: 404 });
    if ((path === "/artifact" || path === "/file") && request.method === "GET") {
      if (run.status !== "completed") return Response.json({ error: "Build artifact is not ready" }, { status: 409 });
      const artifact = await this.env.ARTIFACTS.get(this.ctx.id.toString());
      if (path === "/file" && artifact) {
        const file = new URL(request.url).searchParams.get("path") ?? "";
        const content = extractFileFromTarGz(Buffer.from(await artifact.arrayBuffer()), file);
        return new Response(content, { status: content ? 200 : 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return new Response(artifact?.body, { status: artifact ? 200 : 404,
        headers: { "content-type": "application/gzip", "content-disposition": 'attachment; filename="' + run.input.app + '.tar.gz"' } });
    }
    if (request.method === "DELETE" && path === "/status" && run.status === "running") {
      await this.finish(run, "failed", "Build cancelled");
    }
    return Response.json({
      runId: run.id, app: run.input.app, status: run.status, error: run.error,
      stages: run.stages ?? [], lines: [], approvals: [], fileTree: run.fileTree ?? [],
      createdAt: run.createdAt, updatedAt: run.updatedAt ?? run.createdAt,
    }, { headers: { "cache-control": "private, no-store" } });
  }

  async finish(run, status, error) {
    const current = await this.ctx.storage.get("run");
    if (current?.status !== "running") return;
    run.status = status;
    run.updatedAt = new Date().toISOString();
    run.error = error;
    await this.ctx.storage.put("run", run);
    await this.destroy();
  }

  async supervise() {
    const run = await this.ctx.storage.get("run");
    if (run?.status !== "running") return;
    if (Date.now() >= run.expires) return this.finish(run, "failed", "Build exceeded its 30-minute limit");
    // Install the next tick first so an eviction during I/O cannot orphan the run.
    await this.schedule(15, "supervise");
    const headers = { authorization: "Bearer " + run.capability };
    let step = "starting the container";
    let httpStatus;
    try {
      await this.startAndWaitForPorts({ ports: 8080, startOptions: {
        entrypoint: ["bun", "/workspace/container.ts"], enableInternet: true,
        envVars: { AOMI_RUN_ID: run.id, AOMI_RUN_CAPABILITY: run.capability,
          AOMI_RUN_EXPIRES: String(run.expires), IS_SANDBOX: "1",
          ...(run.input.builder === "claude" ? {
            ANTHROPIC_BASE_URL: "http://model.internal",
            ANTHROPIC_AUTH_TOKEN: run.modelCapability, ANTHROPIC_MODEL: "moonshotai/kimi-k2.7-code",
            ANTHROPIC_SMALL_FAST_MODEL: "moonshotai/kimi-k2.7-code",
          } : run.input.builder === "codex" ? {
            OPENAI_BASE_URL: "http://model.internal/v1", OPENAI_API_KEY: run.modelCapability,
          } : {}) },
      } });
      step = "reading the build status";
      const response = await this.containerFetch("http://runner/start", {
        method: "POST", headers, body: JSON.stringify(run.input),
      });
      if (!response.ok) {
        httpStatus = response.status;
        throw new Error("Container rejected supervision");
      }
      const report = await response.json();
      if (report.runId !== run.id) throw new Error("Container reported a different run");
      step = "saving the build status";
      if ((await this.ctx.storage.get("run"))?.status !== "running") return;
      run.stages = report.stages;
      run.fileTree = report.fileTree;
      run.updatedAt = new Date().toISOString();
      if (report.status === "running") await this.ctx.storage.put("run", run);
      if (report.status === "failed") return this.finish(run, "failed", report.error);
      if (report.status === "completed") {
        step = "reading the build artifact";
        const artifact = await this.containerFetch("http://runner/artifact", { headers });
        if (!artifact.ok || !artifact.body) {
          httpStatus = artifact.status;
          throw new Error("Artifact unavailable");
        }
        const bytes = await readArtifact(artifact.body);
        step = "saving the build artifact";
        await this.env.ARTIFACTS.put(this.ctx.id.toString(), bytes);
        step = "saving the build status";
        await this.finish(run, "completed");
      }
    } catch {
      if ((await this.ctx.storage.get("run"))?.status !== "running") return;
      run.attempts++;
      // Retry logs use fixed stage labels and omit request bodies and error text.
      console.warn("Build runner retry", { runId: run.id, step, httpStatus, attempt: run.attempts });
      if (run.attempts >= 3) {
        return this.finish(run, "failed", `Build runner failed while ${step} after three attempts`);
      }
      await this.ctx.storage.put("run", run);
    }
  }
}

// Assign through the Container setter so ContainerProxy can find the handler.
BuildRun.outboundByHost = {
  "model.internal": (request, env, ctx) =>
    env.RUNS.get(env.RUNS.idFromString(ctx.containerId)).model(request),
};
