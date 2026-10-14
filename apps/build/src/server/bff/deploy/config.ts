import "@tanstack/react-start/server-only";

import { deployConfig } from "@/server/env";

export function resolveDeployPlatform(
  value: unknown,
  config = deployConfig(),
): string | null {
  if (value === undefined) return config.platform;
  if (typeof value !== "string") return null;
  const platform = value.trim();
  // Partner names are deliberately not enumerated in frontend config. This
  // only validates the slug shape; the manager's exact DB lookup decides
  // whether the platform exists, and its user-source filter keeps data owned.
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(platform)) return null;
  return platform;
}
