import "@tanstack/react-start/server-only";

import { backendClient } from "@/server/bff/backend";
import { buildFailures } from "@/server/bff/failures";
import { RequiredSecretsCheckError } from "@aomi-labs/deploy/bff";
import {
  BackendError,
  builderSecretSlots,
  missingRequiredSecrets,
} from "@aomi-labs/deploy";
import { authorize } from "@/server/bff/auth";
import {
  deployErrorContext,
  isValidProjectId,
  isValidApplicationId,
} from "./shared";

export async function deploymentSecretsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  const params = new URL(req.url).searchParams;
  const applicationId = Number(params.get("applicationId"));
  if (!isValidApplicationId(applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const { application } = await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId,
    });
    const { byApp } = await client.listAppSecrets({
      applicationId,
    });
    return Response.json({
      byApp: { [application.name]: byApp[application.name] ?? [] },
    });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.secrets_read"),
    }).response;
  }
}

export async function deploymentSecretsWriteRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    applicationId?: unknown;
    secrets?: unknown;
  };
  if (!isValidApplicationId(body.applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }
  // Accept a { KEY: value } map of non-empty string values.
  const secrets: Record<string, string> = {};
  if (body.secrets && typeof body.secrets === "object") {
    for (const [k, v] of Object.entries(
      body.secrets as Record<string, unknown>,
    )) {
      const key = k.trim();
      if (key && typeof v === "string" && v.length > 0) secrets[key] = v;
    }
  }
  if (Object.keys(secrets).length === 0) {
    return Response.json(
      { error: "no valid secrets provided" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const { application } = await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId: body.applicationId,
    });
    const { handles } = await client.ingestSecrets({
      applicationId: body.applicationId,
      app: application.name,
      secrets,
    });
    return Response.json(
      { ok: true, keys: Object.keys(handles) },
      { status: 202 },
    );
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.secrets_write"),
    }).response;
  }
}

export async function deploymentSecretsDeleteRoute(req: Request) {
  const auth = await authorize(req, { write: true });
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const body = (await req.json().catch(() => ({}))) as {
    applicationId?: unknown;
    name?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "missing `name`" }, { status: 400 });
  }
  if (!isValidApplicationId(body.applicationId)) {
    return Response.json(
      { error: "missing or invalid `applicationId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    await client.getBuilderApplication({
      githubUserId: session.githubUserId,
      applicationId: body.applicationId,
    });
    const removed = await client.removeAppSecret({
      applicationId: body.applicationId,
      name,
    });
    return Response.json({ ok: true, removed });
  } catch (err) {
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.secrets_delete"),
    }).response;
  }
}

// GET /api/bff/deployments/required-secrets?projectId=<n> — the Manager's
// DB-backed secret declarations for each live release plus which required slots
// are still unfilled in the vault. Never returns secret VALUES.
export async function requiredSecretsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!isValidProjectId(projectId)) {
    return Response.json(
      { error: "missing or invalid `projectId`" },
      { status: 400 },
    );
  }

  try {
    const client = await backendClient();
    const declared = await client.getUserProjectRequiredSecrets({
      githubUserId: session.githubUserId,
      projectId,
    });
    const entries = await Promise.all(
      Object.entries(declared.byApp).map(
        async ([app, { applicationId, slots }]) => {
          const configured = await client.listAppSecrets({
            applicationId,
          });
          const configuredKeys = (configured.byApp[app] ?? []).map(
            (handle) => handle.split("::").pop() ?? handle,
          );
          return [
            app,
            {
              applicationId,
              slots: builderSecretSlots(slots),
              missing: missingRequiredSecrets(slots, configuredKeys).map(
                (slot) => slot.name,
              ),
            },
          ] as const;
        },
      ),
    );

    return Response.json({ byApp: Object.fromEntries(entries) });
  } catch (err) {
    if (err instanceof BackendError) {
      if (err.status === 404) {
        return Response.json(
          { error: "project not found for this user" },
          { status: 404 },
        );
      }
      return buildFailures.handle({
        source: "launch",
        error: new RequiredSecretsCheckError({
          cause: err,
          reason: "backend_unavailable",
          upstream: "rust",
          upstreamStatus: err.status,
        }),
        context: deployErrorContext(req, "deployment.required_secrets"),
      }).response;
    }
    return buildFailures.handle({
      source: "launch",
      error: err,
      context: deployErrorContext(req, "deployment.required_secrets"),
    }).response;
  }
}
