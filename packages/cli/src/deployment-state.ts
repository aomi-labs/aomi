import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export interface DeploymentState {
  deploymentId: string;
  platform: string;
  projectId: number;
  releaseTags: string[];
  apps: string[];
  timestamp: string; // ISO 8601
}

const DIR = ".aomi";
const FILE = "deployment.json";

function statePath(cwd: string): string {
  return join(cwd, DIR, FILE);
}

export async function writeDeploymentState(
  state: DeploymentState,
  cwd = process.cwd(),
): Promise<void> {
  const dir = join(cwd, DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(cwd), JSON.stringify(state, null, 2), "utf-8");
}

export async function readDeploymentState(
  cwd = process.cwd(),
): Promise<DeploymentState | null> {
  try {
    const raw = await readFile(statePath(cwd), "utf-8");
    return JSON.parse(raw) as DeploymentState;
  } catch {
    return null;
  }
}
