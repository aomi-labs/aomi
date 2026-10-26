import type { BuildContext } from "./context";

const DEFAULT_TEMPLATE_REPO = "aomi-labs/playground-example";

export type DeployConfig = {
  platform: string;
  platforms: readonly string[];
  templateRepo: string;
  createdRepoPrivate: boolean;
};

/** Where Build deploys apps from and to; the Build BFF read this from its env. */
export function deployConfig(ctx: BuildContext): DeployConfig {
  const flag = (ctx.env.BUILD_CREATED_REPO_PRIVATE ?? "").trim().toLowerCase();
  return {
    platform: ctx.deployPlatforms[0],
    platforms: ctx.deployPlatforms,
    templateRepo: (ctx.env.BUILD_TEMPLATE_REPO ?? "").trim() || DEFAULT_TEMPLATE_REPO,
    createdRepoPrivate: flag === "1" || flag === "true" || flag === "yes",
  };
}

export function resolveDeployPlatform(value: unknown, config: DeployConfig): string | null {
  if (value === undefined) return config.platform;
  if (typeof value !== "string") return null;
  const platform = value.trim();
  // Partner names are deliberately not enumerated in edge config. This only
  // validates the slug shape; the manager's exact DB lookup decides whether
  // the platform exists, and its user-source filter keeps data owned.
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(platform)) return null;
  return platform;
}

export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
