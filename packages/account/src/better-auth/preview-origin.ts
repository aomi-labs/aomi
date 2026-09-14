import { AsyncLocalStorage } from "node:async_hooks";

const previewOrigin = new AsyncLocalStorage<string>();

export function previewWalletAuthOrigin(): string | undefined {
  return previewOrigin.getStore();
}

/** Bind wallet challenges to the host that served this preview request. The
 *  accepted hosts are exact deployment/branch aliases or the configured
 *  canonical Portal; a caller-supplied Origin header never selects a domain. */
export function withPreviewWalletAuthOrigin<T>(
  request: Request,
  env: Record<string, string | undefined>,
  canonicalUrl: string,
  handler: () => T,
): T | Response {
  if (env.VERCEL_ENV !== "preview") return handler();
  const url = new URL(request.url);
  const allowed = [canonicalUrl, env.VERCEL_URL, env.VERCEL_BRANCH_URL].map(
    originFromConfig,
  );
  if (url.protocol !== "https:" || !allowed.includes(url.origin)) {
    return Response.json(
      { code: "PREVIEW_AUTH_ORIGIN_NOT_ALLOWED" },
      { status: 403 },
    );
  }
  return previewOrigin.run(url.origin, handler);
}

function originFromConfig(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
