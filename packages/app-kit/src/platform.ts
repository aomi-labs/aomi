/**
 * Where an app is built and runs. The only app code that reads host-specific
 * variables (VERCEL_*); apps ask these functions instead.
 */
export type AppEnv = Record<string, string | undefined>;

/** The host a build targets: `AOMI_DEPLOY_TARGET`, default `vercel`. */
export type DeployTarget = "vercel" | "cloudflare";

export function deployTarget(env: AppEnv = process.env): DeployTarget {
  const target = env.AOMI_DEPLOY_TARGET || "vercel";
  if (target !== "vercel" && target !== "cloudflare")
    throw new Error(`AOMI_DEPLOY_TARGET must be vercel or cloudflare`);
  return target;
}

/**
 * `production` or `preview` on a hosted deploy, undefined for local runs.
 * Vercel sets VERCEL_ENV; other hosts set AOMI_DEPLOY_STAGE.
 */
export function deployStage(
  env: AppEnv = process.env,
): "production" | "preview" | undefined {
  const stage = env.VERCEL_ENV || env.AOMI_DEPLOY_STAGE;
  return stage === "production" || stage === "preview" ? stage : undefined;
}

/** True on any hosted deploy, including Vercel's development builds. */
export function hosted(env: AppEnv = process.env): boolean {
  return Boolean(env.VERCEL || env.VERCEL_ENV || env.AOMI_DEPLOY_STAGE);
}

/** The deployed commit, from the host or CI. */
export function commitSha(env: AppEnv = process.env): string | undefined {
  return env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || undefined;
}
