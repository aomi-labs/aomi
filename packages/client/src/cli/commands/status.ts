import { DeployCliError } from "../errors";
import { readDeploymentState } from "../../lib/deployment-state";

type StatusArgs = Record<string, unknown>;

interface DeploymentAppStatus {
  name: string;
  releaseTag: string;
  releaseReady: boolean;
  message?: string | null;
}

interface DeploymentStatus {
  state: "building" | "releasing" | "ready" | "failed" | "pending";
  deployment?: Record<string, unknown>;
  releaseTags: string[];
  apps?: DeploymentAppStatus[];
  ci?: { status?: string; url?: string; commitHash?: string };
  message?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireToken(args: StatusArgs): string {
  const token = str(args["activation-token"]) ?? process.env.AOMI_DEPLOY_TOKEN;
  if (!token) {
    throw new DeployCliError(
      "VALIDATION_ERROR",
      "`--activation-token` is required. Pass it or set the AOMI_DEPLOY_TOKEN env var.",
    );
  }
  return token;
}

function resolveBackendUrl(args: StatusArgs): string {
  return (
    str(args["backend-url"]) ??
    process.env.AOMI_BACKEND_URL ??
    "https://api.aomi.dev"
  ).replace(/\/+$/, "");
}

function resolvePlatform(args: StatusArgs): string {
  return (
    str(args.platform) ??
    process.env.AOMI_DEPLOY_PLATFORM ??
    "community"
  );
}

async function fetchStatus(
  deploymentId: string,
  platform: string,
  activationToken: string,
  backendUrl: string,
): Promise<DeploymentStatus> {
  const url = `${backendUrl}/api/platforms/${encodeURIComponent(platform)}/deployments/${encodeURIComponent(deploymentId)}/status`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${activationToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    throw new DeployCliError(
      "NETWORK_ERROR",
      "Cannot reach Aomi backend; check your connection",
    );
  }

  const text = await res.text();
  if (!res.ok) {
    throw DeployCliError.fromHttpFailure(res, text);
  }

  try {
    return JSON.parse(text) as DeploymentStatus;
  } catch {
    throw new DeployCliError("BACKEND_ERROR", "Backend returned invalid JSON.");
  }
}

function printStatus(status: DeploymentStatus): void {
  const CYAN = "\x1b[36m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  console.log(`${CYAN}State:${RESET} ${status.state}`);

  if (status.ci?.url) {
    console.log(`${DIM}CI:${RESET}    ${status.ci.url}`);
  }

  if (status.deployment) {
    const platform = (status.deployment as Record<string, unknown>)?.platform as Record<string, unknown> | undefined;
    if (platform?.pr_url) {
      console.log(`${DIM}PR:${RESET}    ${platform.pr_url}`);
    }
  }

  if (status.apps && status.apps.length > 0) {
    for (const app of status.apps) {
      const tag = app.releaseTag ? ` (${app.releaseTag})` : "";
      console.log(`${DIM}App:${RESET}   ${app.name}${tag}`);
    }
  } else if (status.releaseTags && status.releaseTags.length > 0) {
    for (const tag of status.releaseTags) {
      console.log(`${DIM}Tag:${RESET}   ${tag}`);
    }
  }

  if (status.message) {
    console.log(`${DIM}Msg:${RESET}   ${status.message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function statusCommand(args: StatusArgs): Promise<void> {
  const deploymentId =
    str(args["deployment-id"]) ??
    (await readDeploymentState())?.deploymentId;

  if (!deploymentId) {
    throw new DeployCliError(
      "VALIDATION_ERROR",
      "No deployment ID found. Pass --deployment-id or run `aomi deploy` first.",
    );
  }

  const activationToken = requireToken(args);
  const backendUrl = resolveBackendUrl(args);
  const platform = resolvePlatform(args);
  const watch = args.watch === true;

  if (!watch) {
    const status = await fetchStatus(deploymentId, platform, activationToken, backendUrl);
    printStatus(status);
    return;
  }

  // --watch: poll with exponential backoff
  const MAX_FAILURES = 8;
  const BASE_DELAY_MS = 3_000;
  const MAX_DELAY_MS = 30_000;
  let failures = 0;
  let lastCiUrl: string | undefined;

  while (true) {
    try {
      const status = await fetchStatus(deploymentId, platform, activationToken, backendUrl);
      if (status.ci?.url) lastCiUrl = status.ci.url;
      printStatus(status);
      failures = 0;

      if (status.state === "ready") {
        process.exit(0);
        return;
      }
      if (status.state === "failed") {
        process.exit(1);
        return;
      }

      await sleep(BASE_DELAY_MS);
    } catch (err) {
      failures++;
      if (failures >= MAX_FAILURES) {
        const ciSuffix = lastCiUrl ? `; check CI status at ${lastCiUrl}` : "";
        throw new DeployCliError(
          "BACKEND_ERROR",
          `Deployment timed out after ${MAX_FAILURES} attempts${ciSuffix}`,
        );
      }
      const backoffMs = Math.min(BASE_DELAY_MS * Math.pow(2, failures), MAX_DELAY_MS);
      await sleep(backoffMs);
    }
  }
}
