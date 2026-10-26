/**
 * Request-side wire helpers: body builders for the deploy backend
 * (camelCase input -> snake_case wire) and shared input validators.
 */
import { DeployError } from "../errors";
import type { DeployInput, PreflightInput } from "../types";

export function deployRequest(
  input: DeployInput | PreflightInput,
  preflight: boolean,
): Record<string, unknown> {
  const projectId = Number(input.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new DeployError(
      "INVALID_REQUEST",
      "deploy requires a positive projectId",
    );
  }
  if (preflight) {
    // Preflight may omit `source_ref`; the backend resolves the default head.
    return {
      ...(input.sourceRef ? { source_ref: sourceRef(input.sourceRef) } : {}),
      preflight: true,
    };
  }
  // Apply always pins the exact preflight commit — reject a missing ref here
  // rather than letting an unpinned request reach the backend.
  return {
    source_ref: sourceRef(input.sourceRef),
  };
}

function sourceRef(ref: DeployInput["sourceRef"] | undefined): string {
  const clean = required(ref, "sourceRef");
  if (!/^[0-9a-f]{7,40}$/i.test(clean)) {
    throw new DeployError(
      "INVALID_REQUEST",
      "sourceRef must be a git commit SHA (7-40 hex chars)",
    );
  }
  return clean.toLowerCase();
}

export function required(
  value: string | undefined | null,
  field: string,
): string {
  const clean = value?.trim();
  if (!clean) throw new DeployError("INVALID_REQUEST", `${field} is required`);
  return clean;
}
