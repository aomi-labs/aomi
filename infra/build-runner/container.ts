// One Cloudflare Container per run. Its supervisor passes only run-local credentials.
import { Database } from "bun:sqlite";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";


const runId = process.env.AOMI_RUN_ID;
const capability = process.env.AOMI_RUN_CAPABILITY;
const expires = Number(process.env.AOMI_RUN_EXPIRES);
if (!runId || !capability || !Number.isSafeInteger(expires) || expires <= Date.now()) {
  throw new Error("A live run capability is required");
}
const sdkRoot = "/workspace/aomi-sdk";
let archive: Buffer | undefined;
let status: "idle" | "running" | "completed" | "failed" = "idle";
let app = "";
let failure = "";
let fileTree = [];
let stages: { id: string; label: string; kind: string; status: string }[] = [];

function lastBuildStep(statePath: string): string | undefined {
  try {
    const db = new Database(statePath, { readonly: true });
    try {
      const node = db.query(`SELECT node_id, state FROM _smithers_nodes
        WHERE run_id = ? AND state IN ('failed', 'in-progress', 'finished')
        ORDER BY updated_at_ms DESC, (state = 'failed') DESC, iteration DESC, node_id LIMIT 1`)
        .get(runId!) as { node_id: string; state: string } | null;
      if (!node?.node_id.startsWith(app + ":")) return;
      const label = stepLabel(node.node_id.slice(app.length + 1));
      if (label) return `${node.state === "finished" ? "after" : "during"} ${label}`;
    } finally { db.close(); }
  } catch {
    // The CLI can exit before creating its SQLite state.
  }
}

function stepLabel(step: string): string | undefined {
  switch (step) {
    case "binaries": return "toolchain setup";
    case "codegen": return "OpenAPI discovery or code generation";
    case "curate": return "tool curation";
    case "validate-loop":
    case "validate":
    case "fix": return "application validation";
    case "smoke": return "smoke testing";
    case "result": return "artifact packaging";
  }
}

function processFailure(statePath: string, signal: string | null): string {
  // Child-process output can contain input or credentials. Report fixed labels only.
  const step = lastBuildStep(statePath) ?? "without a recognized build step";
  if (signal === "SIGKILL") return `Build process was killed ${step}`;
  if (signal) return `Build process was interrupted ${step}`;
  return `Build failed ${step}`;
}

async function execute(prompt: string, builder: string) {
  const existing = await Bun.file(join(sdkRoot, "apps", app, "openapi.yaml")).exists();
  const plan = { app, sdkRoot, userStory: prompt, builder, autoApprove: true,
    source: existing ? "existing" : "discover", allowStaleSdk: true };
  const childEnv = { ...process.env };
  delete childEnv.AOMI_RUN_CAPABILITY;
  childEnv.AOMI_RUNNER_SDK_REVISION = (await Bun.file("/workspace/sdk-revision").text()).trim();
  const child = Bun.spawn(["bun", "dist/cli.js", "run-plan", "--plan-b64",
    Buffer.from(JSON.stringify(plan)).toString("base64"), "--run-id", runId!, "--state-root", "/tmp/run-state"], {
    env: childEnv, stdout: "inherit", stderr: "inherit",
  });
  const statePath = join("/tmp/run-state", app, "smithers.sqlite");
  if (await child.exited !== 0) throw new Error(processFailure(statePath, child.signalCode));
  const db = new Database(statePath, { readonly: true });
  try {
    const result = db.query("SELECT status, summary, file_tree_json, crate_tar_b64 FROM result WHERE run_id = ? ORDER BY iteration DESC LIMIT 1")
      .get(runId!) as { status: string; summary: string; file_tree_json: string; crate_tar_b64: string } | null;
    if (result?.status !== "complete" || !result.crate_tar_b64) throw new Error(result?.summary || "Missing build artifact");
    fileTree = JSON.parse(result.file_tree_json || "[]");
    archive = Buffer.from(result.crate_tar_b64, "base64");
  } finally { db.close(); }
}

Bun.serve({
  port: 8080,
  maxRequestBodySize: 32 * 1024,
  async fetch(req) {
    const actual = Buffer.from(req.headers.get("authorization") ?? "");
    const expected = Buffer.from("Bearer " + capability);
    if (Date.now() >= expires || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return new Response(null, { status: 403 });
    }
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/start") {
      const input = await req.json().catch(() => null);
      if (!input || typeof input.app !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.app) ||
          typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 4000 ||
          !["none", "claude", "codex"].includes(input.builder)) return new Response(null, { status: 400 });
      if (status === "idle") {
        app = input.app;
        status = "running";
        stages = [{ id: app + ":build", label: "Build and validate", kind: "compute", status: "running" }];
        void execute(input.prompt, input.builder).then(() => { status = "completed"; stages[0].status = "complete"; }, error => {
          failure = error.message;
          status = "failed";
          stages[0].status = "failed";
        });
      }
    } else if (req.method === "GET" && path === "/artifact" && status === "completed") {
      return new Response(archive, {
        headers: { "content-type": "application/gzip" },
      });
    } else if (req.method !== "GET" || path !== "/status") return new Response(null, { status: 404 });
    return Response.json({ runId, app, status, stages, fileTree, error: failure || undefined });
  },
});
