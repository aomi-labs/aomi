/** Project page tabs — keep in sync with `ProjectPage` TABS. */
export type ProjectTab =
  | "home"
  | "deployments"
  | "providers"
  | "environment"
  | "chat";

/** Deep link into a project. Home omits `?tab=` (default). */
export function projectHref(projectId: number, tab?: ProjectTab): string {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return "/projects";
  if (!tab || tab === "home") return `/projects/${projectId}`;
  return `/projects/${projectId}?tab=${tab}`;
}

/** Last opened project, or the Projects list when none. */
export function lastProjectHref(tab?: ProjectTab): string {
  const id = getLastProjectId();
  if (!id) return "/projects";
  return projectHref(id, tab);
}

/** Operate Usage, optionally scoped to one project. */
export function usageHref(projectId?: number | null): string {
  if (projectId != null && Number.isSafeInteger(projectId) && projectId > 0) {
    return `/operate/usage?project=${projectId}`;
  }
  return "/operate/usage";
}

export function lastUsageHref(): string {
  return usageHref(getLastProjectId());
}

/** Secrets / Environment: last project tab, else Settings → Secrets hub. */
export function lastEnvironmentHref(): string {
  const id = getLastProjectId();
  if (!id) return "/settings/secrets";
  return projectHref(id, "environment");
}

const LAST_PROJECT_KEY = "aomi-build:last-project-id";

export function getLastProjectId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_PROJECT_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function setLastProjectId(projectId: number) {
  if (typeof window === "undefined") return;
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return;
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, String(projectId));
  } catch {
    // ignore quota / private mode
  }
}
