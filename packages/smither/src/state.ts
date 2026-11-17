import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildPlanSchema, type BuildPlan } from "./plan";

export const packageRoot = resolvePackageRoot();
export const defaultRunsRoot = path.join(packageRoot, ".smithers", "runs");

function resolvePackageRoot(cwd = process.cwd()): string {
  const workspacePackage = path.join(
    cwd,
    "packages",
    "smither",
    "package.json",
  );
  if (existsSync(workspacePackage)) {
    return path.join(cwd, "packages", "smither");
  }
  return cwd;
}

export function sanitizePackageName(packageName: string): string {
  return packageName.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function runDir(packageName: string, root = defaultRunsRoot): string {
  return path.join(root, sanitizePackageName(packageName));
}

export function smitherDbPath(
  packageName: string,
  root = defaultRunsRoot,
): string {
  return path.join(runDir(packageName, root), "smithers.sqlite");
}

export function runStatePath(
  packageName: string,
  root = defaultRunsRoot,
): string {
  return path.join(runDir(packageName, root), "run.json");
}

/** Pointer to the durable Smithers run for an package. The run itself (outputs,
 *  approvals, frames) lives in smithers.sqlite; this only remembers which
 *  runId to resume. */
export type RunState = {
  packageName: string;
  runId: string;
  createdAt: string;
};

export async function loadRunState(
  packageName: string,
  root = defaultRunsRoot,
): Promise<RunState | null> {
  try {
    return JSON.parse(
      await readFile(runStatePath(packageName, root), "utf8"),
    ) as RunState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function createRunState(
  packageName: string,
  root = defaultRunsRoot,
  runId?: string,
): Promise<RunState> {
  const state: RunState = {
    packageName,
    runId:
      runId ?? `smither-${sanitizePackageName(packageName)}-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  await mkdir(runDir(packageName, root), { recursive: true });
  await writeFile(
    runStatePath(packageName, root),
    `${JSON.stringify(state, null, 2)}\n`,
  );
  return state;
}

export async function resetRunState(
  packageName: string,
  root = defaultRunsRoot,
): Promise<void> {
  await rm(runDir(packageName, root), { recursive: true, force: true });
}

export function planPath(packageName: string, root = defaultRunsRoot): string {
  return path.join(runDir(packageName, root), "plan.json");
}

/** Persist the BuildPlan beside the run so another process (e.g.
 *  `aomi-smither console --packageName`) can rebuild the identical workflow and
 *  register it for observation. */
export async function savePlan(
  plan: BuildPlan,
  root = defaultRunsRoot,
): Promise<void> {
  await mkdir(runDir(plan.packageName, root), { recursive: true });
  await writeFile(
    planPath(plan.packageName, root),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
}

export async function loadPlan(
  packageName: string,
  root = defaultRunsRoot,
): Promise<BuildPlan | null> {
  try {
    const raw = await readFile(planPath(packageName, root), "utf8");
    return buildPlanSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}
