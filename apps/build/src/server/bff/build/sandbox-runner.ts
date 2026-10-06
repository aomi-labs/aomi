import "server-only";

import type { FailureInput } from "@aomi-labs/observability";
import { buildFailures } from "@/server/bff/failures";

function expectedSandboxAbsence(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const status = Number(candidate.status ?? candidate.statusCode);
  const code =
    typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  return status === 404 || code === "not_found" || code === "sandbox_not_found";
}

function identifySandboxFailure(
  error: unknown,
  operation: string,
): FailureInput {
  return {
    source: "upstream_request",
    upstream: "vercel",
    error,
    context: {
      routeFamily: "/api/bff/build",
      operation,
    },
  };
}

/**
 * Vercel Sandbox dispatch for build runs (ship plan Phase 3).
 *
 * The sandbox boots from a golden image (infra/build-runner/) carrying the
 * Rust toolchain, Bun, the claude CLI, a pinned aomi-sdk checkout, and the
 * built aomi-smither package. The BFF pre-allocates the run id, ships the
 * plan as base64 JSON, and the sandbox executes `aomi-smither run-plan`,
 * writing every state transition to the shared Postgres — which is the only
 * channel the web tier reads (Phase 1), so snapshots work from any instance.
 *
 * Lifecycle: sandboxes are created at Vercel's 5-minute create-time ceiling
 * and extended lazily from the poll path (maybeExtendSandbox) — no background
 * loop, which keeps this serverless-shaped. If nobody polls, the sandbox
 * times out; the run resumes in a fresh sandbox on the next create for the
 * same app (run-plan resumes from store state). Cancel is a durable store
 * write the in-sandbox engine polls; stopping the sandbox is best-effort
 * cleanup on top.
 *
 * The @vercel/sandbox SDK is injected behind SandboxClientLike so tests run
 * against a fake and the module loads without the dependency.
 */

export type SandboxLike = {
  sandboxId: string;
  runCommand(params: {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    detached: true;
  }): Promise<unknown>;
  extendTimeout(durationMs: number): Promise<unknown>;
  stop(): Promise<unknown>;
  /** Public URL for an exposed port (SDK: sandbox.domain(port)). */
  domain?(port: number): string;
};

export type SandboxClientLike = {
  create(params: {
    image: string;
    timeout: number;
    resources: { vcpus: number };
    ports?: number[];
    env: Record<string, string>;
    tags: Record<string, string>;
  }): Promise<SandboxLike>;
};

export type SandboxRunnerConfig = {
  image: string;
  vcpus: number;
  databaseUrl: string;
  /** aomi-sdk checkout path inside the image. */
  sdkRoot: string;
  /** packages/smither dir inside the image (where dist/cli.js lives). */
  smitherDir: string;
  /** Live-files sidecar script inside the image. */
  sidecarPath: string;
  builderApiKey?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
};

/** Create-time ceiling per Vercel; extensions carry the sandbox beyond it. */
const CREATE_TIMEOUT_MS = 5 * 60_000;

/** Exposed port for the live-files sidecar inside the runner image. */
const SIDECAR_PORT = 8722;
const EXTEND_STEP_MS = 10 * 60_000;
const EXTEND_MIN_INTERVAL_MS = 2 * 60_000;

export function sandboxRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SandboxRunnerConfig {
  const image = env.AOMI_RUNNER_IMAGE;
  const databaseUrl = env.SMITHER_DATABASE_URL;
  if (!image || !databaseUrl) {
    throw new Error(
      "sandbox runner needs AOMI_RUNNER_IMAGE and SMITHER_DATABASE_URL " +
        "(the sandbox writes run state to the shared Postgres the web tier reads)",
    );
  }
  return {
    image,
    vcpus: Number(env.AOMI_SANDBOX_VCPUS) || 4,
    databaseUrl,
    sdkRoot: env.AOMI_SANDBOX_SDK_ROOT ?? "/workspace/aomi-sdk",
    smitherDir:
      env.AOMI_SANDBOX_SMITHER_DIR ?? "/workspace/aomi/packages/smither",
    sidecarPath: env.AOMI_SANDBOX_SIDECAR ?? "/workspace/sidecar.ts",
    builderApiKey: env.SMITHER_ANTHROPIC_API_KEY,
    openrouterApiKey: env.SMITHER_OPENROUTER_API_KEY,
    openrouterModel: env.SMITHER_OPENROUTER_MODEL,
  };
}

/** The SDK surface we consume. Sandboxes are identified by `name` — the
 *  Sandbox class has no `sandboxId`/`id` getter, and `Sandbox.get` takes
 *  `{name}` — so the adapter maps `name` onto SandboxLike.sandboxId. */
type SdkSandbox = {
  name: string;
  runCommand(params: unknown): Promise<unknown>;
  extendTimeout(durationMs: number): Promise<unknown>;
  stop(): Promise<unknown>;
  domain(port: number): string;
};

function adaptSdkSandbox(sandbox: SdkSandbox): SandboxLike {
  return {
    sandboxId: sandbox.name,
    runCommand: (params) => sandbox.runCommand(params) as Promise<unknown>,
    extendTimeout: (durationMs) => sandbox.extendTimeout(durationMs),
    stop: () => sandbox.stop(),
    domain: (port) => sandbox.domain(port),
  };
}

async function defaultClient(): Promise<SandboxClientLike> {
  const { Sandbox } = await import("@vercel/sandbox");
  return {
    create: async (params) =>
      adaptSdkSandbox(
        (await Sandbox.create(params as never)) as unknown as SdkSandbox,
      ),
  };
}

export type SandboxDispatch = {
  sandbox: SandboxLike;
  lastExtendMs: number;
  sidecarUrl?: string;
};

/** Boot a sandbox and launch the headless runner for (plan, runId). */
export async function dispatchSandboxRun(options: {
  planJson: string;
  app: string;
  runId: string;
  config: SandboxRunnerConfig;
  client?: SandboxClientLike;
  /** aomi-bff's SPKI public key: the sidecar's bearer-verification anchor
   *  (official service-bearer path — see sidecar-auth.ts). Public material,
   *  so safe in the VM env; empty = the sidecar fails closed. */
  sidecarPublicKeyPem?: string;
}): Promise<SandboxDispatch> {
  const { config } = options;
  const client = options.client ?? (await defaultClient());
  const sandbox = await client.create({
    image: config.image,
    timeout: CREATE_TIMEOUT_MS,
    resources: { vcpus: config.vcpus },
    ports: [SIDECAR_PORT],
    env: {
      SMITHER_DATABASE_URL: config.databaseUrl,
      AOMI_ALLOW_STALE_SDK: "1",
      // The exposed sidecar port is public; requests carry service bearers
      // the BFF mints per request (PORTAL_SERVICE_PRIVATE_KEY), which the
      // sidecar verifies against this public key + run id.
      AOMI_SIDECAR_PUBKEY: options.sidecarPublicKeyPem ?? "",
      AOMI_SIDECAR_RUN_ID: options.runId,
      AOMI_SIDECAR_PORT: String(SIDECAR_PORT),
      AOMI_SIDECAR_APP: options.app,
      // The image runs as root and the claude CLI refuses its
      // skip-permissions flags under root unless it knows it's inside a
      // sandbox. The microVM is exactly that.
      IS_SANDBOX: "1",
      ...(config.builderApiKey
        ? { SMITHER_ANTHROPIC_API_KEY: config.builderApiKey }
        : {}),
      // OpenRouter wins inside the workflow when present (resolveAgentBilling);
      // the Anthropic key rides along as the env-only rollback path.
      ...(config.openrouterApiKey
        ? { SMITHER_OPENROUTER_API_KEY: config.openrouterApiKey }
        : {}),
      ...(config.openrouterModel
        ? { SMITHER_OPENROUTER_MODEL: config.openrouterModel }
        : {}),
    },
    tags: { app: options.app.slice(0, 64) },
  });
  // Live-files sidecar first (serves apps/<app> while the run works), then
  // the runner. Older images without the sidecar script just log an error
  // for the first command; the run itself is unaffected.
  await sandbox.runCommand({
    cmd: "bun",
    args: [config.sidecarPath, config.sdkRoot],
    detached: true,
  });
  await sandbox.runCommand({
    cmd: "bun",
    args: [
      "dist/cli.js",
      "run-plan",
      "--plan-b64",
      Buffer.from(options.planJson, "utf8").toString("base64"),
      "--run-id",
      options.runId,
    ],
    cwd: config.smitherDir,
    detached: true,
  });
  let sidecarUrl = "";
  try {
    sidecarUrl = sandbox.domain?.(SIDECAR_PORT) ?? "";
  } catch (error) {
    buildFailures.handle(identifySandboxFailure(error, "build.sandbox_domain"));
    sidecarUrl = "";
  }
  return { sandbox, lastExtendMs: Date.now(), sidecarUrl };
}

/** Lazily extend the sandbox from the poll path while the run is live. */
export async function maybeExtendSandbox(
  dispatch: SandboxDispatch,
  nowMs = Date.now(),
): Promise<boolean> {
  if (nowMs - dispatch.lastExtendMs < EXTEND_MIN_INTERVAL_MS) return false;
  dispatch.lastExtendMs = nowMs;
  try {
    await dispatch.sandbox.extendTimeout(EXTEND_STEP_MS);
    return true;
  } catch (error) {
    buildFailures.handle(identifySandboxFailure(error, "build.sandbox_extend"));
    // Expired/stopped sandbox — the run resumes in a fresh one on re-create.
    return false;
  }
}

export async function stopSandbox(dispatch: SandboxDispatch): Promise<void> {
  try {
    await dispatch.sandbox.stop();
  } catch (error) {
    if (!expectedSandboxAbsence(error)) {
      buildFailures.handle(identifySandboxFailure(error, "build.sandbox_stop"));
    }
    // Best-effort: durable cancel already reached the store.
  }
}

/** By-id sandbox handle for processes that never held the dispatch (the
 *  supervisor, cancel-after-restart). */
async function getSandboxById(sandboxId: string): Promise<SandboxLike | null> {
  try {
    const { Sandbox } = await import("@vercel/sandbox");
    const get = (
      Sandbox as unknown as {
        get(params: { name: string; resume: boolean }): Promise<SdkSandbox>;
      }
    ).get;
    // resume:false — never resurrect a lapsed sandbox just to manage it.
    return adaptSdkSandbox(
      await get.call(Sandbox, { name: sandboxId, resume: false }),
    );
  } catch (error) {
    if (!expectedSandboxAbsence(error)) {
      buildFailures.handle(
        identifySandboxFailure(error, "build.sandbox_lookup"),
      );
    }
    return null;
  }
}

export async function stopSandboxById(sandboxId: string): Promise<void> {
  const sandbox = await getSandboxById(sandboxId);
  if (!sandbox) return;
  try {
    await sandbox.stop();
  } catch (error) {
    if (!expectedSandboxAbsence(error)) {
      buildFailures.handle(
        identifySandboxFailure(error, "build.sandbox_stop_by_id"),
      );
    }
    // Already stopped/expired — the goal state.
  }
}

/** Supervisor-side keepalive: extend a running sandbox by id. Returns false
 *  when the sandbox is unreachable (stopped, expired, or never healthy). */
export async function extendSandboxById(sandboxId: string): Promise<boolean> {
  const sandbox = await getSandboxById(sandboxId);
  if (!sandbox) return false;
  try {
    await sandbox.extendTimeout(EXTEND_STEP_MS);
    return true;
  } catch (error) {
    buildFailures.handle(
      identifySandboxFailure(error, "build.sandbox_extend_by_id"),
    );
    return false;
  }
}
