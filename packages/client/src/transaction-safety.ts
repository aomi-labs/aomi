import type { components } from "./generated/agent-v1/types";
import type { AomiHttpMethod, AomiRequestOptions } from "./types";

import { agentSchemas } from "./generated/agent-v1/schemas";
import { validatePipelineArguments } from "./pipeline/schema";

type Schemas = components["schemas"];
export type TransactionSafetyMode = Schemas["TransactionSafetyMode"];
export type TransactionSafetyPolicy = Schemas["TransactionSafetyPolicy"];
export type TransactionSafetyAssessment = Schemas["GuardAssessment"];
export type TransactionSafetyDecision = Schemas["TransactionSafetyDecision"];
export type TransactionSafetyProjection =
  Schemas["TransactionSafetyProjection"];

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

/** Authenticated user control plane, separate from wallet and on-chain policy. */
export class TransactionSafetyTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  getAccountDefault(): Promise<TransactionSafetyPolicy> {
    return this.request("GET", "/v1/account/transaction-safety");
  }
  setAccountDefault(
    mode: Exclude<TransactionSafetyMode, "unrestricted">,
    expectedRevision: number,
  ): Promise<TransactionSafetyPolicy> {
    return this.request("PUT", "/v1/account/transaction-safety", {
      mode,
      expectedRevision,
    });
  }
  getThread(threadId: string): Promise<TransactionSafetyPolicy> {
    return this.request(
      "GET",
      "/v1/account/transaction-safety/threads/" + encodeURIComponent(threadId),
    );
  }
  setThread(
    threadId: string,
    mode: TransactionSafetyMode,
    expectedRevision: number,
  ): Promise<TransactionSafetyPolicy> {
    return this.request(
      "PUT",
      "/v1/account/transaction-safety/threads/" + encodeURIComponent(threadId),
      { mode, expectedRevision },
    );
  }
  private async request(
    method: AomiHttpMethod,
    path: string,
    body?: { mode: TransactionSafetyMode; expectedRevision: number },
  ): Promise<TransactionSafetyPolicy> {
    if (
      body &&
      (!Number.isSafeInteger(body.expectedRevision) ||
        body.expectedRevision < 1)
    )
      throw new TypeError(
        "An authoritative positive policy revision is required",
      );
    const response = await this.requestResponse(method, path, {
      body,
      headers: body
        ? { "Content-Type": "application/json", "X-Aomi-CSRF": "1" }
        : undefined,
    });
    if (!response.ok)
      throw new Error(
        (await response.text()) ||
          `Transaction safety request failed: ${response.status}`,
      );
    const value: unknown = await response.json();
    return transactionSafetyPolicy(value);
  }
}

export function transactionSafetyPolicy(
  value: unknown,
): TransactionSafetyPolicy {
  validatePipelineArguments(
    value,
    agentSchemas.TransactionSafetyPolicy,
    agentSchemas,
  );
  return value as TransactionSafetyPolicy;
}
