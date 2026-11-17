export const buildQueryKeys = {
  all: ["aomi-build"] as const,
  projects: (account: string, platform?: string | null) =>
    [
      ...buildQueryKeys.all,
      "account",
      account,
      "projects",
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
  agentDetail: (account: string, agentId: number) =>
    [
      ...buildQueryKeys.all,
      "account",
      account,
      "operate",
      "observability-detail",
      agentId,
    ] as const,
  channels: (account: string) =>
    [...buildQueryKeys.all, "account", account, "channels"] as const,
  modelKeys: (account: string) =>
    [...buildQueryKeys.all, "account", account, "model-keys"] as const,
  githubApp: (account: string) =>
    [...buildQueryKeys.all, "account", account, "github-app"] as const,
};

export const buildQueryStaleTime = {
  operate: 30_000,
  modelKeys: 60_000,
  githubApp: 5 * 60_000,
} as const;

export function githubAccountKey(login: string | null): string | null {
  const normalized = login?.trim().toLowerCase();
  return normalized || null;
}
