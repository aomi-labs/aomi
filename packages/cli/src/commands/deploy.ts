import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ManagerClient } from "@aomi-labs/internal/manager";
import { json, out, usage } from "../context";

export type DeployFlags = {
  backendUrl?: string;
  activationToken?: string;
  platform?: string;
  json?: boolean;
};

/** What `aomi deploy` leaves for `deploy status` and `deploy activate`. */
type Recorded = { deploymentId: string; platform: string; projectId: number };
const RECORD = join(process.cwd(), ".aomi", "deployment.json");

function manager(flags: DeployFlags): ManagerClient {
  const bearer = flags.activationToken ?? process.env.AOMI_DEPLOY_TOKEN;
  if (!bearer) throw usage("Pass --activation-token or set AOMI_DEPLOY_TOKEN");
  return new ManagerClient({
    url: flags.backendUrl ?? process.env.AOMI_BACKEND_URL ?? "https://api.aomi.dev",
    bearer,
  });
}

const recorded = async (): Promise<Recorded | null> =>
  JSON.parse(await readFile(RECORD, "utf8").catch(() => "null")) as Recorded | null;

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    throw usage(`git ${args.join(" ")} failed; run this inside your app's repository`);
  }
}

export async function deploy(
  flags: DeployFlags & { projectId?: number; branch?: string; commit?: string; preflight?: boolean },
): Promise<void> {
  const projectId = flags.projectId ?? Number(process.env.AOMI_PROJECT_ID);
  if (!Number.isSafeInteger(projectId) || projectId <= 0)
    throw usage("Pass --project-id or set AOMI_PROJECT_ID");
  if (flags.branch && flags.commit) throw usage("Choose --branch or --commit");
  const sourceRef = git("rev-parse", "--verify", `${flags.commit ?? flags.branch ?? "HEAD"}^{commit}`);
  const client = manager(flags);
  const result = flags.preflight
    ? await client.preflight({ projectId, sourceRef })
    : await client.deploy({ projectId, sourceRef });
  if (flags.json) return json(result);
  const { deployment } = result;
  out(`${flags.preflight ? "Preflight" : "Deployment"} ${deployment.id}  ${deployment.status}`);
  out(`commit  ${sourceRef}`);
  if (deployment.platform.prUrl) out(`PR      ${deployment.platform.prUrl}`);
  if (deployment.platform.ciUrl) out(`CI      ${deployment.platform.ciUrl}`);
  for (const app of deployment.platform.apps) out(`app     ${app.name} (${app.releaseTag})`);
  if (flags.preflight) return;
  await mkdir(join(process.cwd(), ".aomi"), { recursive: true });
  await writeFile(
    RECORD,
    JSON.stringify({ deploymentId: deployment.id, platform: deployment.platform.platform, projectId }, null, 2),
  );
}

async function target(flags: DeployFlags & { deploymentId?: string }) {
  const saved = await recorded();
  const deploymentId = flags.deploymentId ?? saved?.deploymentId;
  if (!deploymentId) throw usage("No deployment yet: run aomi deploy, or pass --deployment-id");
  return {
    deploymentId,
    platform: flags.platform ?? saved?.platform ?? process.env.AOMI_DEPLOY_PLATFORM ?? "community",
  };
}

export async function status(flags: DeployFlags & { deploymentId?: string; watch?: boolean }): Promise<void> {
  const client = manager(flags);
  const input = await target(flags);
  for (;;) {
    const current = await client.status(input);
    if (flags.json) json(current);
    else {
      out(`State  ${current.state}${current.ci?.url ? `  ${current.ci.url}` : ""}`);
      for (const app of current.apps) out(`App    ${app.name} (${app.releaseTag})`);
      if (current.message) out(current.message);
    }
    if (current.state === "failed") process.exitCode = 1;
    if (!flags.watch || current.state === "ready" || current.state === "failed") return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

export async function activate(flags: DeployFlags & { deploymentId?: string }): Promise<void> {
  const result = await manager(flags).promote(await target(flags));
  if (flags.json) return json(result);
  for (const app of result.promote.activation?.apps ?? [])
    if ("error" in app && app.error) out(`${app.name}: ${String(app.error)}`);
  out(result.ok ? `Activated ${result.promote.releaseTags.join(", ")}` : `Activation ${result.promote.status}`);
  if (!result.ok) process.exitCode = 1;
}
