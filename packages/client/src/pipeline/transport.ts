import type { AomiHttpMethod, AomiRequestOptions } from "../types";
import { AomiApiError, apiErrorFields, isRetryableStatus } from "../api-error";
import { validatePipelineArguments, withTopic } from "./schema";
import type {
  EvmCommitResult,
  EvmSimulatedBuild,
  EvmStageInput,
  EvmStagedBuild,
  PipelineCommitOptions,
  PipelineBuildOrigin,
  PipelineDirectory,
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

export class PipelineApiError extends AomiApiError {
  override name = "PipelineApiError";
}

/** One chain family's Build routes. Each mutation sends the request's
 * transactionSafetyMode override when given; otherwise the sealed Build mode
 * (or, before a Build exists, the account default) applies. A Build runs as
 * the agent its input names, and is simulated and committed as the agent its
 * origin seals. */
class ChainPipelineTransport<
  StageInput extends PipelineExecutionScope,
  Staged extends { origin: PipelineBuildOrigin },
  Simulated extends { digest: string; origin: PipelineBuildOrigin },
  Committed,
> {
  constructor(
    private readonly requestResponse: RequestResponse,
    private readonly family: "evm" | "svm",
  ) {}

  build(
    { agent, ...input }: PipelineOperationBuildInput,
    options: PipelineMutationOptions = {},
  ): Promise<Simulated> {
    return this.post("build", agent, mutationHeaders(options), {
      ...jsonBody(input),
      ...safetyMode(options),
    });
  }

  stage(
    { agent, ...input }: StageInput,
    options: PipelineMutationOptions = {},
  ): Promise<Staged> {
    return this.post("stage", agent, mutationHeaders(options), {
      ...jsonBody(input),
      ...safetyMode(options),
    });
  }

  simulate(
    build: Staged,
    options: PipelineMutationOptions = {},
  ): Promise<Simulated> {
    return this.post("simulate", build.origin.agent, mutationHeaders(options), {
      build: jsonBody(build),
      ...safetyMode(options),
    });
  }

  commit(
    build: Simulated,
    options: PipelineCommitOptions = {},
  ): Promise<Committed> {
    return this.post(
      "commit",
      build.origin.agent,
      commitHeaders(build.digest, options),
      { build: jsonBody(build), ...safetyMode(options) },
    );
  }

  private post<T>(
    step: "build" | "stage" | "simulate" | "commit",
    agent: string | undefined,
    headers: HeadersInit,
    body: Record<string, unknown>,
  ): Promise<T> {
    return json(
      this.requestResponse,
      "POST",
      asAgent(`/v1/pipeline/${this.family}/${step}`, agent),
      { headers, body },
    );
  }
}

export class EvmPipelineTransport extends ChainPipelineTransport<
  EvmStageInput,
  EvmStagedBuild,
  EvmSimulatedBuild,
  EvmCommitResult
> {
  constructor(requestResponse: RequestResponse) {
    super(requestResponse, "evm");
  }
}

export class SvmPipelineTransport extends ChainPipelineTransport<
  SvmStageInput,
  SvmStagedBuild,
  SvmSimulatedBuild,
  SvmCommitResult
> {
  constructor(requestResponse: RequestResponse) {
    super(requestResponse, "svm");
  }
}

function safetyMode(options: PipelineMutationOptions) {
  return options.transactionSafetyMode === undefined
    ? {}
    : { transactionSafetyMode: options.transactionSafetyMode };
}

/** `path` as `agent`, `publisher/name`; none is `aomi/main`. */
function asAgent(path: string, agent?: string): string {
  return agent ? `${path}?agent=${encodeURIComponent(agent)}` : path;
}

/** The operations an agent may run, or only one package's of them. */
export class PipelineOperationsTransport {
  readonly executionScope: PipelineExecutionScope;

  constructor(
    protected readonly requestResponse: RequestResponse,
    /** The scope's path, without the agent. */
    readonly href: string,
    readonly agent?: string,
    packageId?: string,
  ) {
    this.executionScope = {
      ...(agent ? { agent } : {}),
      ...(packageId ? { packages: [packageId] } : {}),
    };
  }

  protected at(path: string): string {
    return asAgent(`${this.href}${path}`, this.agent);
  }

  operations(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", this.at("/operations"));
  }

  operation(name: string): Promise<PipelineOperationDescriptor> {
    return json(this.requestResponse, "GET", this.operationPath(name));
  }

  invoke<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    options?: PipelineInvokeOptions,
  ): Promise<T> {
    return invokeOperation(
      this.requestResponse,
      this.operationPath(name),
      args,
      options,
    );
  }

  private operationPath(name: string): string {
    return this.at(
      `/operations/${encodeURIComponent(required("operation", name))}`,
    );
  }
}

/** One agent's Pipeline: its core operations, every operation and its packages. */
export class PipelineAgentTransport extends PipelineOperationsTransport {
  constructor(requestResponse: RequestResponse, agent?: string) {
    super(requestResponse, "/v1/pipeline", agent);
  }

  /** Operations of no package: the host's own. */
  core(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", this.at("/core"));
  }

  /** The packages on for this agent. */
  packages(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", this.at("/packages"));
  }

  package(id: string): PipelinePackageTransport {
    return new PipelinePackageTransport(
      this.requestResponse,
      required("package", id),
      this.agent,
    );
  }
}

/** One package, `publisher/name`, as an agent has it on. */
export class PipelinePackageTransport extends PipelineOperationsTransport {
  constructor(requestResponse: RequestResponse, id: string, agent?: string) {
    super(
      requestResponse,
      `/v1/pipeline/packages/${encodeURIComponent(id)}`,
      agent,
      id,
    );
  }

  /** Its skill files and operations. */
  directory(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", this.at(""));
  }

  /** One skill file's markdown, as released. */
  async skill(file: string): Promise<string> {
    const response = await this.requestResponse(
      "GET",
      this.at(`/skills/${encodeURIComponent(required("file", file))}`),
      { headers: { accept: "text/markdown" } },
    );
    if (!response.ok) throw await pipelineError(response);
    return response.text();
  }
}

/** The wire-close typed transport for every first-party Pipeline consumer. */
export class PipelineTransport {
  readonly evm: EvmPipelineTransport;
  readonly svm: SvmPipelineTransport;

  constructor(private readonly requestResponse: RequestResponse) {
    this.evm = new EvmPipelineTransport(requestResponse);
    this.svm = new SvmPipelineTransport(requestResponse);
  }

  root(): Promise<PipelineDirectory> {
    return json(this.requestResponse, "GET", "/v1/pipeline");
  }

  read(path = "/v1/pipeline"): Promise<PipelineFilesystemResource> {
    return json(this.requestResponse, "GET", pipelinePath(path));
  }

  /** `agent`'s Pipeline, `publisher/name`; none is `aomi/main`. */
  agent(agent?: string): PipelineAgentTransport {
    return new PipelineAgentTransport(this.requestResponse, agent);
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
    args = withTopic(args, descriptor.name, descriptor.inputSchema);
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
  const error = apiErrorFields(await response.json().catch(() => null));
  return new PipelineApiError(
    response.status,
    error.code ?? "pipeline_request_failed",
    error.message ?? `Pipeline request failed with HTTP ${response.status}`,
    isRetryableStatus(response.status),
    error.requestId ?? response.headers.get("x-request-id") ?? undefined,
    error.details,
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
