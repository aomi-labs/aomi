import type { AomiHttpMethod, AomiRequestOptions } from "../types";
import { validatePipelineArguments } from "./schema";
import type {
  EvmCommitResult,
  EvmSimulatedBuild,
  EvmStageInput,
  EvmStagedBuild,
  PipelineCommitOptions,
  PipelineDirectory,
  PipelineErrorBody,
  PipelineExecutionScope,
  PipelineFilesystemResource,
  PipelineInvokeOptions,
  PipelineMutationOptions,
  PipelineOperationBuildInput,
  PipelineOperationDescriptor,
  SvmCommitResult,
  SvmSimulatedBuild,
  SvmStageInput,
  SvmStagedBuild,
} from "./types";

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

export class PipelineApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PipelineApiError";
  }
}

export class EvmPipelineTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  build(
    input: PipelineOperationBuildInput,
    options: PipelineMutationOptions = {},
  ): Promise<EvmSimulatedBuild> {
    return json(this.requestResponse, "POST", "/v1/pipeline/evm/build", {
      headers: mutationHeaders(options),
      body: jsonBody(input),
    });
  }

  stage(
    input: EvmStageInput,
    options: PipelineMutationOptions = {},
  ): Promise<EvmStagedBuild> {
    return json(this.requestResponse, "POST", "/v1/pipeline/evm/stage", {
      headers: mutationHeaders(options),
      body: jsonBody(input),
    });
  }

  simulate(
    build: EvmStagedBuild,
    options: PipelineMutationOptions = {},
  ): Promise<EvmSimulatedBuild> {
    return json(this.requestResponse, "POST", "/v1/pipeline/evm/simulate", {
      headers: mutationHeaders(options),
      body: { build: jsonBody(build) },
    });
  }

  commit(
    build: EvmSimulatedBuild,
    options: PipelineCommitOptions = {},
  ): Promise<EvmCommitResult> {
    return json(this.requestResponse, "POST", "/v1/pipeline/evm/commit", {
      headers: commitHeaders(build.digest, options),
      body: { build: jsonBody(build) },
    });
  }
}

export class SvmPipelineTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  build(
    input: PipelineOperationBuildInput,
    options: PipelineMutationOptions = {},
  ): Promise<SvmSimulatedBuild> {
    return json(this.requestResponse, "POST", "/v1/pipeline/svm/build", {
      headers: mutationHeaders(options),
      body: jsonBody(input),
    });
  }

  stage(
    input: SvmStageInput,
    options: PipelineMutationOptions = {},
  ): Promise<SvmStagedBuild> {
    return json(this.requestResponse, "POST", "/v1/pipeline/svm/stage", {
      headers: mutationHeaders(options),
      body: jsonBody(input),
    });
  }

  simulate(
    build: SvmStagedBuild,
    options: PipelineMutationOptions = {},
  ): Promise<SvmSimulatedBuild> {
    return json(this.requestResponse, "POST", "/v1/pipeline/svm/simulate", {
      headers: mutationHeaders(options),
      body: { build: jsonBody(build) },
    });
  }

  commit(
    build: SvmSimulatedBuild,
    options: PipelineCommitOptions = {},
  ): Promise<SvmCommitResult> {
    return json(this.requestResponse, "POST", "/v1/pipeline/svm/commit", {
      headers: commitHeaders(build.digest, options),
      body: { build: jsonBody(build) },
    });
  }
}

export class PipelineOperationTransport {
  readonly href: string;
  readonly executionScope: PipelineExecutionScope;

  constructor(
    private readonly requestResponse: RequestResponse,
    scope: "apps" | "skills",
    owner: string,
  ) {
    const name = required("name", owner);
    this.href = `/v1/pipeline/${scope}/${encodeURIComponent(name)}`;
    this.executionScope = scope === "apps" ? { app: name } : { skills: [name] };
  }

  directory(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", this.href);
  }

  operations(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", `${this.href}/operations`);
  }

  operation(name: string): Promise<PipelineOperationDescriptor> {
    return json(
      this.requestResponse,
      "GET",
      `${this.href}/operations/${encodeURIComponent(required("operation", name))}`,
    );
  }

  invoke<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    options?: PipelineInvokeOptions,
  ): Promise<T> {
    return invokeOperation(
      this.requestResponse,
      `${this.href}/operations/${encodeURIComponent(required("operation", name))}`,
      args,
      options,
    );
  }
}

export class PipelineSkillTransport extends PipelineOperationTransport {
  constructor(
    private readonly skillRequestResponse: RequestResponse,
    skill: string,
  ) {
    super(skillRequestResponse, "skills", skill);
  }

  async instructions(): Promise<string> {
    const response = await this.skillRequestResponse(
      "GET",
      `${this.href}/SKILL.md`,
      { headers: { accept: "text/markdown" } },
    );
    if (!response.ok) throw await pipelineError(response);
    return response.text();
  }
}

export class PipelineAppsTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  list(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", "/v1/pipeline/apps");
  }

  get(app: string): PipelineOperationTransport {
    return new PipelineOperationTransport(this.requestResponse, "apps", app);
  }
}

export class PipelineSkillsTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  list(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", "/v1/pipeline/skills");
  }

  get(skill: string): PipelineSkillTransport {
    return new PipelineSkillTransport(this.requestResponse, skill);
  }
}

/** The wire-close typed transport for every first-party Pipeline consumer. */
export class PipelineTransport {
  readonly evm: EvmPipelineTransport;
  readonly svm: SvmPipelineTransport;
  readonly apps: PipelineAppsTransport;
  readonly skills: PipelineSkillsTransport;

  constructor(private readonly requestResponse: RequestResponse) {
    this.evm = new EvmPipelineTransport(requestResponse);
    this.svm = new SvmPipelineTransport(requestResponse);
    this.apps = new PipelineAppsTransport(requestResponse);
    this.skills = new PipelineSkillsTransport(requestResponse);
  }

  root(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", "/v1/pipeline");
  }

  read(path = "/v1/pipeline"): Promise<PipelineFilesystemResource> {
    return json(this.requestResponse, "GET", pipelinePath(path));
  }

  app(name: string): PipelineOperationTransport {
    return this.apps.get(name);
  }

  skill(name: string): PipelineSkillTransport {
    return this.skills.get(name);
  }

  invoke<T = unknown>(
    path: string,
    args: Record<string, unknown>,
    options?: PipelineInvokeOptions,
  ): Promise<T> {
    return invokeOperation(
      this.requestResponse,
      operationPath(path),
      args,
      options,
    );
  }
}

async function invokeOperation<T>(
  requestResponse: RequestResponse,
  path: string,
  args: Record<string, unknown>,
  options: PipelineInvokeOptions = {},
): Promise<T> {
  if (options.validate !== false) {
    const descriptor = await json<PipelineOperationDescriptor>(
      requestResponse,
      "GET",
      path,
    );
    validatePipelineArguments(args, descriptor.inputSchema);
  }
  return json(requestResponse, "POST", path, {
    headers: mutationHeaders(options),
    body: jsonBody(args),
  });
}

async function json<T>(
  requestResponse: RequestResponse,
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
): Promise<T> {
  return parsePipelineResponse<T>(await requestResponse(method, path, options));
}

async function parsePipelineResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  throw await pipelineError(response);
}

async function pipelineError(response: Response): Promise<PipelineApiError> {
  const body = (await response
    .json()
    .catch(() => null)) as PipelineErrorBody | null;
  const error = asRecord(body?.error);
  return new PipelineApiError(
    response.status,
    stringValue(error?.code) ?? "pipeline_request_failed",
    stringValue(error?.message) ??
      `Pipeline request failed with HTTP ${response.status}`,
    response.status === 408 ||
      response.status === 429 ||
      response.status >= 500,
    stringValue(error?.requestId) ??
      response.headers.get("x-request-id") ??
      undefined,
    error?.details,
  );
}

function jsonBody<T>(value: T): T {
  return normalizeJson(value) as T;
}

function normalizeJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return value;
}

function required(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function pipelinePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const full = normalized.startsWith("/v1/pipeline")
    ? normalized
    : `/v1/pipeline${normalized}`;
  if (full !== "/v1/pipeline" && !full.startsWith("/v1/pipeline/")) {
    throw new TypeError("path must resolve beneath /v1/pipeline");
  }
  return full.replace(/\/+$/, "");
}

function operationPath(path: string): string {
  const full = pipelinePath(path);
  if (!/\/operations\/[^/]+$/.test(full)) {
    throw new TypeError("operation path must end in /operations/{operation}");
  }
  return full;
}

function commitHeaders(
  digest: string,
  options: PipelineCommitOptions,
): HeadersInit {
  return mutationHeaders({
    ...options,
    idempotencyKey: options.idempotencyKey ?? digest,
  });
}

function mutationHeaders(options: {
  idempotencyKey?: string;
  paymentSignature?: string;
}): HeadersInit {
  return {
    "idempotency-key": required(
      "idempotencyKey",
      options.idempotencyKey ?? randomIdempotencyKey(),
    ),
    ...(options.paymentSignature
      ? { "payment-signature": options.paymentSignature }
      : {}),
  };
}

function randomIdempotencyKey(): string {
  return `idem_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
