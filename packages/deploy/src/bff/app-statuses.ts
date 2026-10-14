import type { PlatformApp } from "../types";
import type { LaunchAppStatusesResult } from "../launch/contracts";

/** Map BackendClient app flags to the browser-safe project runtime contract. */
export function launchAppStatusesResult(
  projectId: number,
  apps: readonly PlatformApp[],
): LaunchAppStatusesResult {
  const runtimeApps = apps.map((app) => ({
    id: app.id,
    name: app.name,
    is_active: app.isActive,
    loaded: app.loaded === true,
    app_release_tag: app.appReleaseTag,
  }));
  const live =
    runtimeApps.length > 0 &&
    runtimeApps.every((app) => app.is_active && app.loaded);
  return {
    ok: true,
    projectId,
    state: live ? "live" : "pending",
    apps: runtimeApps,
  };
}
