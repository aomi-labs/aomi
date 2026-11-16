import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearSecret,
  fetchAgent,
  fetchPackage,
  fetchPublisher,
  fetchReleases,
  promote,
  setSecret,
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

/** Set (with a value) or clear (null) one builder secret of a package. */
export function useSecret(name: string) {
  const queries = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, value }: { slot: string; value: string | null }) =>
      value == null ? clearSecret(name, slot) : setSecret(name, slot, value),
    onSuccess: () => queries.invalidateQueries({ queryKey: keys.package(name) }),
  });
}
