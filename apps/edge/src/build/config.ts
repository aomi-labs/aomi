import type { BuildContext } from "./context";

export type DeployConfig = {
  platform: string;
  platforms: readonly string[];
  templateRepo: string;
  createdRepoPrivate: boolean;
};

/** Where Build deploys apps from and to. */
export function deployConfig(ctx: BuildContext): DeployConfig {
  const { platforms, templateRepo, createdRepoPrivate } = ctx.config;
  return { platform: platforms[0], platforms, templateRepo, createdRepoPrivate };
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
