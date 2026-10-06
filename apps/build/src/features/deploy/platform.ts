/**
 * The selected deployment platform.
 *
 * Partner scope travels in `?platform=`, which is correct for a page but not
 * for the shell: the sidebar, command palette, and back links are static, so
 * the first click on any of them would drop the param and silently return a
 * partner developer to Community. The selection is therefore also persisted
 * here and re-attached to the routes that understand it.
 *
 * This is deliberately not `LaunchState.platform` — that one records which
 * platform the wizard's in-flight progress belongs to, and restarting a wizard
 * should not change which platform you are browsing.
 */
const STORAGE_KEY = "aomi_build_platform";

export function readPlatform(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function writePlatform(platform: string | null) {
  if (typeof window === "undefined") return;
  try {
    const value = platform?.trim();
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked or full; never let that break navigation.
  }
}

import { platformParam as rawPlatformParam } from "@aomi-labs/deploy/launch";
import { DEFAULT_DEPLOY_PLATFORM } from "@build/lib/deploy-platform";

/**
 * The platform a page renders against. Build has no unscoped view — every
 * source is bound to exactly one platform, and a URL without `?platform=`
 * means the default (Community).
 */
export function platformParam(value: string | string[] | undefined): string {
  return rawPlatformParam(value) ?? DEFAULT_DEPLOY_PLATFORM;
}

/**
 * Routes whose navigation stays inside one platform. Project detail still
 * derives authority from the canonical Project; carrying the query here keeps
 * surrounding links and the return path in the same visible scope.
 */
function isPlatformScoped(href: string): boolean {
  return (
    href === "/overview" ||
    href === "/projects" ||
    href.startsWith("/projects/") ||
    href === "/operate/deployments" ||
    href === "/operate/deployments/new"
  );
}

/** Re-attach the active platform to a platform-scoped href. */
export function platformHref(
  href: string,
  platform: string | null | undefined,
): string {
  if (!platform) return href;
  const [pathname, query = ""] = href.split("?", 2);
  if (!isPlatformScoped(pathname)) return href;
  const params = new URLSearchParams(query);
  params.set("platform", platform);
  return `${pathname}?${params}`;
}
