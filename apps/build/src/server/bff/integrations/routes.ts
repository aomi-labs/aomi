import "@tanstack/react-start/server-only";

import { authorize } from "@/server/bff/auth";
import {
  INTEGRATION_PROVIDERS,
  getIntegrationProvider,
} from "@/features/integrations/providers";

export async function integrationsStatusRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;

  // TODO(integrations): report real connection status once a backend credential
  // store exists. Until then every provider reports disconnected.
  return Response.json({
    statuses: INTEGRATION_PROVIDERS.map((provider) => ({
      provider: provider.id,
      connected: false,
    })),
  });
}

export async function integrationsConnectRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as {
    provider?: unknown;
    values?: unknown;
  };
  const provider =
    typeof body.provider === "string"
      ? getIntegrationProvider(body.provider)
      : undefined;
  if (!provider) {
    return Response.json(
      { error: "unknown integration provider" },
      { status: 400 },
    );
  }

  const values = (body.values ?? {}) as Record<string, unknown>;
  const missing = provider.fields
    .filter(
      (field) => field.required && !String(values[field.key] ?? "").trim(),
    )
    .map((field) => field.label);
  if (missing.length > 0) {
    return Response.json(
      { error: `Missing required field(s): ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  // TODO(integrations): persist the submitted credentials to a real backend
  // secret store keyed by the GitHub-scoped account. No such store exists yet,
  // so we validate the request shape and return not-implemented rather than
  // silently accepting (and dropping) the tokens.
  return Response.json(
    {
      error: `Saving ${provider.name} credentials is not available yet.`,
    },
    { status: 501 },
  );
}
