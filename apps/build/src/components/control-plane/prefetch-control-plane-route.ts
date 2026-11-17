import type { QueryClient } from "@tanstack/react-query";

import {
  buildQueryKeys,
  buildQueryStaleTime,
} from "@/features/deploy/query-keys";
import {
  modelKeysFetch,
  operateAgentDetailFetch,
  operateFetch,
  type OperateKind,
} from "@/features/operate/client";

const OPERATE_ROUTES: Record<string, OperateKind> = {
  "/operate/channels": "channels",
  "/operate/logs": "logs",
  "/operate/observability": "observability",
  "/operate/transactions": "transactions",
  "/operate/usage": "usage",
};

/**
 * Warm only the route a user shows intent to open. This keeps the persistent
 * sidebar from eagerly downloading every control-plane route and API payload
 * while still hiding latency between hover/focus and click.
 */
export function prefetchControlPlaneRoute(
  queryClient: QueryClient,
  href: string,
  accountKey: string | null,
): boolean {
  if (!accountKey) return false;
  const path = href.split("?")[0];
  const searchParams = new URLSearchParams(href.split("?")[1]);
  const detailMatch = path.match(/^\/operate\/observability\/([1-9]\d*)$/);
  if (detailMatch) {
    const agentId = Number(detailMatch[1]);
    void queryClient.prefetchQuery({
      queryKey: buildQueryKeys.agentDetail(accountKey, agentId),
      queryFn: () => operateAgentDetailFetch(agentId),
      staleTime: buildQueryStaleTime.operate,
      retry: false,
    });
    return true;
  }

  if (path === "/integrations") {
    void queryClient.prefetchQuery({
      queryKey: buildQueryKeys.channels(accountKey),
      queryFn: () => operateFetch("channels"),
      staleTime: buildQueryStaleTime.operate,
      retry: false,
    });
    return true;
  }

  if (path === "/providers") {
    void queryClient.prefetchQuery({
      queryKey: buildQueryKeys.modelKeys(accountKey),
      queryFn: () => modelKeysFetch<unknown>(),
      staleTime: buildQueryStaleTime.modelKeys,
      retry: false,
    });
    return true;
  }

  const kind = OPERATE_ROUTES[path];
  if (!kind) return false;
  const projectId = Number(searchParams.get("project"));
  const scopedProjectId =
    Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null;
  void queryClient.prefetchQuery({
    queryKey:
      kind === "channels"
        ? buildQueryKeys.channels(accountKey)
        : buildQueryKeys.operate(accountKey, kind, scopedProjectId),
    queryFn: () =>
      kind === "channels"
        ? operateFetch(kind)
        : operateFetch(kind, { projectId: scopedProjectId }),
    staleTime: buildQueryStaleTime.operate,
    retry: false,
  });
  return true;
}
