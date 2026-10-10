import "@tanstack/react-start/server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { FailureInput } from "@aomi-labs/observability";
import { authorize } from "@/server/bff/auth";
import type {
  BuildRunDecisionRequest,
  CreateBuildRunRequest,
} from "@/features/build/run-contracts";
import {
  BuildEngineError,
  cancelBuildRun,
  decideBuildRun,
  getBuildRun,
  readRunFile,
  reconstructBuildRun,
  snapshotBuildRun,
  startBuildRun,
  storedCrateTarball,
} from "./engine";
import { buildFailures } from "@/server/bff/failures";

function identifyBuildRouteFailure(
  error: unknown,
  req: Request,
  operation: string,
): FailureInput {
  const context = {
    routeFamily: new URL(req.url).pathname,
    operation,
    method: req.method,
  };
  if (error instanceof BuildEngineError) {
    if (error.status < 500) {
      return {
        source: "expected",
        error,
        response: { status: error.status, error: error.message },
        context,
      };
    }
    return {
      source: "local",
      error,
      response: { status: error.status, error: error.message },
      context,
    };
  }
  return {
    source: "local",
    error,
    response: { status: 500, error: "build engine error" },
    context,
  };
}

const APP_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export async function createBuildRunRoute(req: Request): Promise<Response> {
  const auth = await authorize(req, { write: true, allowAnon: true });
  if ("response" in auth) return auth.response;

  let body: CreateBuildRunRequest;
  try {
    body = (await req.json()) as CreateBuildRunRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 4000) {
    return Response.json(
      { error: "prompt must be 1–4000 characters" },
      { status: 400 },
    );
  }
  if (body.app !== undefined && !APP_NAME.test(body.app)) {
    return Response.json(
      { error: "app must match [a-zA-Z0-9_-]{1,64}" },
      { status: 400 },
    );
  }
  if (
    body.builder !== undefined &&
    !["claude", "codex", "none"].includes(body.builder)
  ) {
    return Response.json(
      { error: "builder must be claude, codex, or none" },
      { status: 400 },
    );
  }

  try {
    const handle = await startBuildRun({
      prompt,
      owner: auth.session?.githubLogin || "dev",
      app: body.app,
      autoApprove: body.autoApprove,
      builder: body.builder,
    });
    const snapshot = await snapshotBuildRun(handle);
    return Response.json({
      runId: snapshot.runId,
      app: snapshot.app,
      stages: snapshot.stages,
    });
  } catch (error) {
    return buildFailures.handle(
      identifyBuildRouteFailure(error, req, "build.start"),
    ).response;
  }
}

export async function buildRunStatusRoute(req: Request): Promise<Response> {
  const auth = await authorize(req, { allowAnon: true });
  if ("response" in auth) return auth.response;

  const runId = new URL(req.url).searchParams.get("id");
  if (!runId) {
    return Response.json({ error: "missing id" }, { status: 400 });
  }
  // Registry miss ≠ unknown run: another instance (or a past process life)
  // may own it — reconstruct an observer handle from the durable store.
  try {
    const handle = getBuildRun(runId) ?? (await reconstructBuildRun(runId));
    if (!handle) {
      return Response.json({ error: "unknown run" }, { status: 404 });
    }
    return Response.json(await snapshotBuildRun(handle));
  } catch (error) {
    return buildFailures.handle(
      identifyBuildRouteFailure(error, req, "build.status"),
    ).response;
  }
}

/** Request cancellation — a durable store write the executing engine polls,
 *  so it works from any instance (and, later, for sandbox runners). */
export async function buildRunCancelRoute(req: Request): Promise<Response> {
  const auth = await authorize(req, { write: true, allowAnon: true });
  if ("response" in auth) return auth.response;

  let body: { runId?: unknown };
  try {
    body = (await req.json()) as { runId?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.runId !== "string") {
    return Response.json({ error: "runId is required" }, { status: 400 });
  }
  try {
    await cancelBuildRun(body.runId);
    return Response.json({ ok: true });
  } catch (error) {
    return buildFailures.handle(
      identifyBuildRouteFailure(error, req, "build.cancel"),
    ).response;
  }
}

/** Stream the generated crate (apps/<app>) as a tarball. */
export async function buildRunDownloadRoute(
  req: Request,
): Promise<Response | Response> {
  const auth = await authorize(req, { allowAnon: true });
  if ("response" in auth) return auth.response;

  const runId = new URL(req.url).searchParams.get("id");
  if (!runId) {
    return Response.json({ error: "missing id" }, { status: 400 });
  }
  try {
    const handle = getBuildRun(runId) ?? (await reconstructBuildRun(runId));
    if (!handle) {
      return Response.json({ error: "unknown run" }, { status: 404 });
    }
    const appsDir = path.join(handle.plan.sdkRoot, "apps");
    if (!existsSync(path.join(appsDir, handle.app))) {
      // No local crate (sandbox runs — the crate lives in the sandbox's
      // filesystem): serve the artifact the result phase embedded in the store.
      const stored = await storedCrateTarball(handle).catch(
        (error: unknown) => {
          buildFailures.handle({
            source: "local",
            error,
            response: {
              status: 409,
              error: "no generated crate yet — run the build first",
            },
            context: {
              routeFamily: new URL(req.url).pathname,
              operation: "build.download_artifact_read",
              method: req.method,
            },
          });
          return null;
        },
      );
      if (stored) {
        return new Response(new Uint8Array(stored), {
          headers: {
            "Content-Type": "application/gzip",
            "Content-Disposition": `attachment; filename="${handle.app}.tar.gz"`,
          },
        });
      }
      return Response.json(
        { error: "no generated crate yet — run the build first" },
        { status: 409 },
      );
    }
    // Stream `tar` directly; the crate is small (target/ excluded).
    const tar = spawn("tar", [
      "-cz",
      "--exclude",
      "target",
      "--exclude",
      "Cargo.lock",
      "-C",
      appsDir,
      handle.app,
    ]);
    let spawnFailed = false;
    tar.once("error", (error) => {
      spawnFailed = true;
      buildFailures.handle({
        source: "local",
        error,
        context: {
          routeFamily: new URL(req.url).pathname,
          operation: "build.download_tar",
          method: req.method,
        },
      });
    });
    tar.once("close", (code) => {
      if (code === 0 || spawnFailed) return;
      buildFailures.handle({
        source: "local",
        error: new Error("Build tar subprocess failed"),
        context: {
          routeFamily: new URL(req.url).pathname,
          operation: "build.download_tar",
          method: req.method,
        },
      });
    });
    return new Response(Readable.toWeb(tar.stdout) as ReadableStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${handle.app}.tar.gz"`,
      },
    });
  } catch (error) {
    return buildFailures.handle(
      identifyBuildRouteFailure(error, req, "build.download"),
    ).response;
  }
}

/** One generated-crate file (display path "<app>/src/tool.rs") — live disk,
 *  live sidecar, or the store's embedded tarball, whichever is freshest. */
export async function buildRunFileRoute(
  req: Request,
): Promise<Response | Response> {
  const auth = await authorize(req, { allowAnon: true });
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const runId = url.searchParams.get("id");
  const filePath = url.searchParams.get("path");
  if (!runId || !filePath) {
    return Response.json({ error: "missing id or path" }, { status: 400 });
  }
  try {
    const handle = getBuildRun(runId) ?? (await reconstructBuildRun(runId));
    if (!handle) {
      return Response.json({ error: "unknown run" }, { status: 404 });
    }
    const body = await readRunFile(handle, filePath);
    if (!body) {
      return Response.json({ error: "file not found" }, { status: 404 });
    }
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return buildFailures.handle(
      identifyBuildRouteFailure(error, req, "build.file"),
    ).response;
  }
}

export async function buildRunDecisionRoute(req: Request): Promise<Response> {
  const auth = await authorize(req, { write: true, allowAnon: true });
  if ("response" in auth) return auth.response;

  let body: BuildRunDecisionRequest;
  try {
    body = (await req.json()) as BuildRunDecisionRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (
    typeof body.runId !== "string" ||
    typeof body.nodeId !== "string" ||
    !Number.isSafeInteger(body.iteration) ||
    body.iteration < 0 ||
    typeof body.approve !== "boolean"
  ) {
    return Response.json(
      { error: "runId, nodeId, iteration, approve are required" },
      { status: 400 },
    );
  }

  try {
    await decideBuildRun({
      runId: body.runId,
      nodeId: body.nodeId,
      iteration: body.iteration,
      approve: body.approve,
      note: body.note,
      selection: body.selection,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return buildFailures.handle(
      identifyBuildRouteFailure(error, req, "build.decision"),
    ).response;
  }
}
