import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  fetchAgent,
  fetchPackage,
  fetchPublisher,
  fetchReleases,
  promote,
  setSecret,
  shortName,
  type Publisher,
  type Release,
  type ReleaseKind,
} from "./client";

export const keys = {
  publisher: ["build", "publisher"] as const,
  agent: (name: string) => ["build", "agent", name] as const,
  package: (name: string) => ["build", "package", name] as const,
  releases: (kind: ReleaseKind, name: string) =>
    ["build", "releases", kind, name] as const,
};

export const usePublisher = () =>
  useQuery({ queryKey: keys.publisher, queryFn: fetchPublisher });

export const useAgent = (name: string) =>
  useQuery({ queryKey: keys.agent(name), queryFn: () => fetchAgent(name) });

export const usePackage = (name: string) =>
  useQuery({ queryKey: keys.package(name), queryFn: () => fetchPackage(name) });

export const useReleases = (kind: ReleaseKind, name: string) =>
  useQuery({
    queryKey: keys.releases(kind, name),
    queryFn: () => fetchReleases(kind, name),
  });

/** One read per id, in order; an entry is undefined until its read lands. */
export const usePackages = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.package(shortName(id)),
      queryFn: () => fetchPackage(shortName(id)),
    })),
    combine: (results) => results.map((result) => result.data),
  });

export const useAgents = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.agent(shortName(id)),
      queryFn: () => fetchAgent(shortName(id)),
    })),
    combine: (results) => results.map((result) => result.data),
  });

/** One release or agent config, with what it belongs to and whether it is live. */
export type ReleaseEntry = {
  kind: ReleaseKind;
  /** `publisher/name` */
  id: string;
  name: string;
  release: Release;
  /** The owner's live number, sent back as `expected_live` on a promote. */
  liveNumber: number | null;
  live: boolean;
};

/** Every release of every package and agent the publisher owns, newest first. */
export function useAllReleases(publisher: Publisher | undefined) {
  const owners = [
    ...(publisher?.packages ?? []).map((pkg) => ({
      kind: "package" as const,
      id: pkg.id,
      name: pkg.display_name,
    })),
    ...(publisher?.agents ?? []).map((agent) => ({
      kind: "agent" as const,
      id: agent.id,
      name: agent.display_name,
    })),
  ];
  return useQueries({
    queries: owners.map((owner) => ({
      queryKey: keys.releases(owner.kind, shortName(owner.id)),
      queryFn: () => fetchReleases(owner.kind, shortName(owner.id)),
    })),
    combine: (results) => ({
      refetch: () => Promise.all(results.map((result) => result.refetch())),
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.error)?.error ?? null,
      entries: results
        .flatMap((result, index) =>
          (result.data?.releases ?? []).map(
            (release): ReleaseEntry => ({
              ...owners[index],
              release,
              liveNumber: result.data?.live ?? null,
              live: release.number === result.data?.live,
            }),
          ),
        )
        .sort((a, b) =>
          b.release.created_at.localeCompare(a.release.created_at),
        ),
    }),
  });
}

/** Promote one release (rollback is a promote) and refresh every read that shows the live pointer. */
export function usePromote(kind: ReleaseKind, name: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (input: { number: number; expectedLive: number | null }) =>
      promote({ kind, name, ...input }),
    onSettled: () =>
      Promise.all([
        queries.invalidateQueries({ queryKey: keys.releases(kind, name) }),
        queries.invalidateQueries({
          queryKey: kind === "package" ? keys.package(name) : keys.agent(name),
        }),
        queries.invalidateQueries({ queryKey: keys.publisher }),
      ]),
  });
}

/** Set one builder secret of a package. Its value is never read back. */
export function useSecret(name: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, value }: { slot: string; value: string }) =>
      setSecret(name, slot, value),
    onSuccess: () =>
      queries.invalidateQueries({ queryKey: keys.package(name) }),
  });
}
