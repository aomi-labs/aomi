import type {
  ListDeploymentRecordsInput,
  ListDeploymentRecordsResult,
  PromoteInput,
  PromoteResult,
} from "@aomi-labs/deploy";
import { BackendClient } from "@aomi-labs/internal";
import { resolveActivationCredential } from "./commands";

/**
 * The two manager calls a rollback needs. Written out rather than picked from
 * `BackendClient` so the published typings name only `@aomi-labs/deploy` types;
 * `@aomi-labs/internal` is private and bundled, never a dependency.
 */
export type RollbackClient = {
  listDeploymentRecords(
    input: ListDeploymentRecordsInput,
  ): Promise<ListDeploymentRecordsResult>;
  promote(input: PromoteInput): Promise<PromoteResult>;
};

export type RollbackTarget = {
  deploymentId: string;
  releaseTag: string;
  action: string;
  createdAt: number;
  current: boolean;
};

export type RollbackPlanSummary = {
  app: string;
  current: RollbackTarget | null;
  /** Newest activation whose release tag differs from the live one. */
  previous: RollbackTarget | null;
  activations: RollbackTarget[];
};

export function planRollback(
  result: ListDeploymentRecordsResult,
): RollbackPlanSummary {
  const activations = result.records.map((row) => ({
    deploymentId: row.deploymentId,
    releaseTag: row.releaseTag,
    action: "promote",
    createdAt: row.createdAt,
    current: row.current,
  }));
  const current = activations.find((row) => row.current) ?? null;
  const previous =
    activations.find((row) => row.releaseTag !== result.currentReleaseTag) ??
    null;
  return { app: result.app, current, previous, activations };
}

export async function executeRollback(
  client: RollbackClient,
  input: { platform: string; app: string; deploymentId: string },
): Promise<{ ok: boolean; releaseTags: string[]; status: string }> {
  const result = await client.promote({
    platform: input.platform,
    deploymentId: input.deploymentId,
    apps: [input.app],
    actor: "aomi-smither",
  });
  return {
    ok: result.ok,
    releaseTags: result.promote.releaseTags,
    status: result.promote.status,
  };
}

export async function rollbackClientFromEnv(options: {
  env?: NodeJS.ProcessEnv;
  activationToken?: string;
  backendUrl?: string;
}): Promise<RollbackClient> {
  const env = options.env ?? process.env;
  const backendUrl = options.backendUrl ?? env.AOMI_BACKEND_URL;
  if (!backendUrl) {
    throw new Error(
      "No backend URL. Pass --backend-url or set AOMI_BACKEND_URL.",
    );
  }
  const activation = await resolveActivationCredential({
    activationToken: options.activationToken,
    env,
  });
  if (!activation) {
    throw new Error(
      "No activation token found. Set AOMI_APP_ACTIVATION_TOKEN or pass --activation-token.",
    );
  }
  return new BackendClient({
    aomi: { backendUrl, activationToken: activation.token },
  });
}
