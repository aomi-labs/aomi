export const buildQueryKeys = {
  all: ["aomi-build"] as const,
  sdkStatus: () => [...buildQueryKeys.all, "sdk-status"] as const,
  projects: (account: string, platform?: string | null) =>
    [
      ...buildQueryKeys.all,
      "account",
      account,
      "projects",
      platform?.trim() || "all",
    ] as const,
  // A Project ID is canonical and already owns its platform binding.
  projectSource: (account: string, projectId: number) =>
    [...buildQueryKeys.all, "account", account, "project", projectId] as const,
  deployments: (account: string, platform?: string | null) =>
    [
      ...buildQueryKeys.all,
      "account",
      account,
      "deployments",
      platform?.trim() || "all",
    ] as const,
  operate: (account: string, kind: string, projectId: number | null = null) =>
    [
      ...buildQueryKeys.all,
      "account",
      account,
      "operate",
      kind,
      projectId ?? "all",
    ] as const,
  applicationDetail: (account: string, applicationId: number) =>
    [
      ...buildQueryKeys.all,
      "account",
      account,
      "operate",
      "observability-detail",
      applicationId,
    ] as const,
  bots: (account: string) =>
    [...buildQueryKeys.all, "account", account, "bots"] as const,
  modelKeys: (account: string) =>
    [...buildQueryKeys.all, "account", account, "model-keys"] as const,
  githubApp: (account: string) =>
    [...buildQueryKeys.all, "account", account, "github-app"] as const,
};

export const buildQueryStaleTime = {
  projects: 60_000,
  deployments: 15_000,
  sdkStatus: 5 * 60_000,
  operate: 30_000,
  modelKeys: 60_000,
  githubApp: 5 * 60_000,
} as const;

export function githubAccountKey(login: string | null): string | null {
  const normalized = login?.trim().toLowerCase();
  return normalized || null;
}
