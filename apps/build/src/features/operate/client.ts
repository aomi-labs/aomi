"use client";

import { buildFetch } from "@/lib/session-expiry";
import { API_PATHS } from "@/lib/api-paths";
import { HttpRequestError, readJsonResponse } from "@/lib/request-retry";

export type OperateKind =
  | "bots"
  | "transactions"
  | "usage"
  | "logs"
  | "observability";

export type OperateFetchOptions = {
  projectId?: number | null;
  cursor?: unknown;
  limit?: number;
};

// Operate reads fan out across every source on the server, so a degraded
// backend used to leave the view on "Loading" until the platform's function
// timeout. Give up first and surface a real error the user can act on.
const OPERATE_FETCH_TIMEOUT_MS = 25_000;

async function operateJson<T>(url: string, label: string): Promise<T> {
  let res: Response;
  try {
    res = await buildFetch(url, {
      signal: AbortSignal.timeout(OPERATE_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new HttpRequestError(
        `${label} timed out after ${OPERATE_FETCH_TIMEOUT_MS / 1000}s — the backend is slow or unavailable. Try a single source instead of All projects.`,
        { retryable: false },
      );
    }
    throw err;
  }
  return readJsonResponse<T>(res, `${label} failed`);
}

export async function operateFetch<T>(
  kind: OperateKind,
  options: OperateFetchOptions = {},
): Promise<T> {
  const path = API_PATHS.bff.operate[kind];
  const params = new URLSearchParams();
  if (options.projectId) {
    params.set("projectId", String(options.projectId));
  }
  if (options.cursor) {
    params.set(
      "cursor",
      typeof options.cursor === "string"
        ? options.cursor
        : JSON.stringify(options.cursor),
    );
  }
  if (options.limit) params.set("limit", String(options.limit));
  return operateJson<T>(`${path}${params.size ? `?${params}` : ""}`, kind);
}

export async function operatePaymentsFetch<T>(
  options: Pick<OperateFetchOptions, "projectId"> = {},
): Promise<T> {
  const params = new URLSearchParams();
  if (options.projectId) params.set("projectId", String(options.projectId));
  return operateJson<T>(
    `${API_PATHS.bff.operate.payments}${params.size ? `?${params}` : ""}`,
    "payments",
  );
}

export async function operateAppDetailFetch<T>(
  applicationId: number,
): Promise<T> {
  return operateJson<T>(
    API_PATHS.bff.operate.observabilityDetail(applicationId),
    "observability detail",
  );
}

export async function modelKeysFetch<T>(): Promise<T> {
  return operateJson<T>(API_PATHS.bff.operate.modelKeys, "model keys");
}
