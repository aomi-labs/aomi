import { existsSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayOptions } from "smithers-orchestrator";
import { stagesFor, type BuildPlan } from "./plan";
import { assertBunRuntime, decideApproval, sendSignal } from "./run";
import { defaultRunsRoot, loadPlan, smitherDbPath } from "./state";
import {
  buildPackageWorkflow,
  createAomiSmither,
  type AomiSmitherApi,
  type AomiWorkflow,
} from "./workflow";

/** A gateway UI registration: `true` mounts the built-in operator console;
 *  the object form points at a custom browser entry bundled by the gateway. */
type UiRegistration =
  | boolean
  | { entry: string; title?: string; props?: Record<string, unknown> };

/** Structural view of the Gateway surface we drive. The class itself is
 *  imported lazily so the CLI stays fast when no console is requested. */
type GatewayLike = {
  register: (
    key: string,
    workflow: AomiWorkflow,
    options?: { ui?: UiRegistration },
  ) => GatewayLike;
  listen: (options?: {
    port?: number;
    host?: string;
  }) => Promise<{ address: () => unknown }>;
  close: () => Promise<void>;
};

/**
 * Absolute path to the branded UI entry (`src/ui/aomi-smither.tsx`), resolved
 * relative to this module so it works from `dist/` and from source alike (both
 * sit one level under the package root). Returns null if the source file isn't
 * present (e.g. an install without `src/`), so the caller falls back to the
 * built-in console. The gateway bundles this with `Bun.build` on first request.
 */
function resolveBrandedEntry(): string | null {
  try {
    const packageRoot = path.dirname(
      path.dirname(fileURLToPath(import.meta.url)),
    );
    const entry = path.join(packageRoot, "src", "ui", "aomi-smither.tsx");
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

export type ConsoleHandle = {
  port: number;
  host: string;
  /** Built-in Smithers operator console (gateway-level, at /console) — every
   *  registered workflow, generic run tree, approvals. */
  consoleUrl: string;
  /** Per-workflow view at /workflows/<package>: the aomi-branded UI when its entry
   *  is available, else the built-in workflow console. */
  workflowUrl: string;
  /** Loopback decision endpoint (POST /decide) when the console was started
   *  with a run api — the write path for select-mode clarify decisions. */
  decideUrl?: string;
  close: () => Promise<void>;
};

export type ConsoleOptions = {
  workflow: AomiWorkflow;
  packageName: string;
  /** The Smithers api backing this run's SQLite. When present, a small
   *  decision endpoint boots beside the gateway so the branded UI can submit
   *  select-mode (clarify) decisions — the stock gateway approve route drops
   *  the decision payload in 0.26.1, so selections need this side channel. */
  api?: AomiSmitherApi;
  /** The plan behind this workflow. When present, its stage list is passed to
   *  the branded UI as boot props so the stage rail shows friendly labels
   *  immediately (before any event arrives). */
  plan?: BuildPlan;
  /** Force the built-in Smithers operator console instead of the aomi-branded
   *  UI (escape hatch / parity check). @default false */
  builtinConsole?: boolean;
  /** First port to try; increments on EADDRINUSE. @default 7331 */
  port?: number;
  /** @default "127.0.0.1" — loopback only; no auth is configured, so the
   *  gateway must never bind a routable interface. */
  host?: string;
  /** @default 10 */
  maxPortTries?: number;
};

/** Choose the UI registration for `register()`: branded custom entry when
 *  available, else the built-in operator console. */
function uiRegistration(
  options: ConsoleOptions,
  decideUrl?: string,
): UiRegistration {
  if (options.builtinConsole) return true;
  const entry = resolveBrandedEntry();
  if (!entry) return true;
  return {
    entry,
    title: `aomi smither · ${options.packageName}`,
    props: {
      packageName: options.packageName,
      stages: options.plan ? stagesFor(options.plan) : [],
      ...(decideUrl ? { decideUrl } : {}),
    },
  };
}

/**
 * Loopback endpoint beside the gateway for run inputs the stock gateway can't
 * carry. `POST /decide` writes an approval/clarify decision (the gateway
 * approve route drops the decision payload in 0.26.1). `POST /signal` delivers
 * an external signal that resolves a wait-external pause. Both are durable
 * writes any external system can make (a CI, a teammate) — not just the TUI.
 */
function startDecisionServer(
  api: AomiSmitherApi,
  host: string,
): Promise<{
  server: Server;
  port: number;
}> {
  const readJson = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolveBody, reject) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (body.length > 64_000) req.destroy();
      });
      req.on("end", () => {
        try {
          resolveBody(JSON.parse(body || "{}"));
        } catch (error) {
          reject(error);
        }
      });
    });

  const server = createHttpServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const route =
      req.url === "/decide" || req.url === "/signal" ? req.url : null;
    if (req.method !== "POST" || !route) {
      res
        .writeHead(404)
        .end(JSON.stringify({ error: "POST /decide or /signal only" }));
      return;
    }
    void (async () => {
      try {
        const parsed = (await readJson(req)) as {
          runId?: string;
          nodeId?: string;
          iteration?: number;
          approve?: boolean;
          selected?: string;
          notes?: string;
          ready?: boolean;
          receivedBy?: string;
        };
        if (!parsed.runId || !parsed.nodeId) {
          res
            .writeHead(400)
            .end(JSON.stringify({ error: "runId and nodeId required" }));
          return;
        }
        if (route === "/signal") {
          await sendSignal({
            api,
            runId: parsed.runId,
            nodeId: parsed.nodeId,
            ready: parsed.ready ?? true,
            note: parsed.notes ?? "",
            receivedBy: parsed.receivedBy ?? "aomi-smither-console",
          });
        } else {
          await decideApproval({
            api,
            runId: parsed.runId,
            nodeId: parsed.nodeId,
            iteration: parsed.iteration ?? 0,
            approve: parsed.approve ?? true,
            decidedBy: "aomi-smither-console",
            ...(parsed.selected
              ? {
                  selection: { selected: parsed.selected, notes: parsed.notes },
                }
              : {}),
          });
        }
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: String(error instanceof Error ? error.message : error),
          }),
        );
      }
    })();
  });
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    // Port 0: the OS picks a free port; no retry loop needed.
    server.listen({ host, port: 0 }, () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      resolvePort({ server, port });
    });
  });
}

export const DEFAULT_CONSOLE_PORT = 7331;

function isAddrInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

/** Whether (host, port) is bindable right now. Must run BEFORE
 *  `gateway.listen`: on a busy port the gateway's internal server emits an
 *  unhandled 'error' event that crashes the process — it never rejects, so a
 *  try/catch around listen() cannot implement port retry. */
function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", () => resolveProbe(false));
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(() => resolveProbe(true));
    });
  });
}

function boundPort(
  server: { address: () => unknown },
  fallback: number,
): number {
  const addr = server.address();
  if (addr && typeof addr === "object" && "port" in addr) {
    return Number((addr as { port: number }).port);
  }
  return fallback;
}

/**
 * Boot a Smithers Gateway sidecar for one package workflow and serve the built-in
 * operator console. The gateway shares the workflow's SQLite store, so runs
 * executed by this process (or any other process on the same DB — the
 * out-of-process event bridge polls persisted events) stream live into the
 * browser: task graph, node outputs, events, and approve/deny controls.
 *
 * No auth is configured — the unauthenticated gateway grants the operator
 * role to every caller, which is only acceptable because we bind loopback.
 */
export async function startConsole(
  options: ConsoleOptions,
): Promise<ConsoleHandle> {
  const { Gateway } =
    (await import("smithers-orchestrator/gateway")) as unknown as {
      Gateway: new (opts?: GatewayOptions) => GatewayLike;
    };
  const host = options.host ?? "127.0.0.1";
  const firstPort = options.port ?? DEFAULT_CONSOLE_PORT;
  const tries = Math.max(1, options.maxPortTries ?? 10);

  const decisions = options.api
    ? await startDecisionServer(options.api, host)
    : null;
  const ui = uiRegistration(
    options,
    decisions ? `http://${host}:${decisions.port}/decide` : undefined,
  );
  let lastError: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const port = firstPort + attempt;
    if (!(await probePort(host, port))) {
      lastError = new Error(`port ${port} in use`);
      continue;
    }
    // A fresh Gateway per attempt: a failed listen() can leave a dead server
    // handle on the instance, and register() is cheap (config + idempotent DDL).
    const gateway = new Gateway({});
    gateway.register(options.packageName, options.workflow, { ui });
    try {
      const server = await gateway.listen({ port, host });
      const actualPort = boundPort(server, port);
      const origin = `http://${host}:${actualPort}`;
      return {
        port: actualPort,
        host,
        consoleUrl: `${origin}/console`,
        // ui:true mounts the built-in console at the workflow-level default
        // path, /workflows/<key> (see resolveGatewayUiConfig).
        workflowUrl: `${origin}/workflows/${encodeURIComponent(options.packageName)}`,
        ...(decisions
          ? { decideUrl: `http://${host}:${decisions.port}/decide` }
          : {}),
        close: async () => {
          decisions?.server.close();
          await gateway.close();
        },
      };
    } catch (error) {
      // Backstop for the probe→listen race; keep trying on address conflicts.
      await gateway.close().catch(() => {});
      if (!isAddrInUse(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error(
    `No free console port in ${firstPort}..${firstPort + tries - 1}: ${String(
      (lastError as Error | undefined)?.message ?? lastError,
    )}`,
  );
}

/**
 * Observer mode: boot a console for an package whose run lives (or lived) in this
 * package's run state — typically while `aomi-smither --packageName <name>` executes
 * in another terminal. Rebuilds the identical workflow from the persisted
 * plan.json and registers it without running anything; the gateway's
 * out-of-process event bridge streams the executing run's persisted events.
 */
export async function startConsoleForApp(options: {
  packageName: string;
  runsRoot?: string;
  port?: number;
  host?: string;
  builtinConsole?: boolean;
}): Promise<ConsoleHandle> {
  assertBunRuntime();
  const runsRoot = options.runsRoot ?? defaultRunsRoot;
  const plan = await loadPlan(options.packageName, runsRoot);
  if (!plan) {
    throw new Error(
      `No stored plan for package "${options.packageName}" under ${runsRoot}. Start a run first — plan.json is written when a run starts.`,
    );
  }
  const api = await createAomiSmither(
    smitherDbPath(options.packageName, runsRoot),
  );
  // Register-only workflow: agents/runners are constructed but never invoked.
  const workflow = await buildPackageWorkflow(api, plan);
  return startConsole({
    workflow,
    packageName: options.packageName,
    api,
    plan,
    builtinConsole: options.builtinConsole,
    port: options.port,
    host: options.host,
  });
}
