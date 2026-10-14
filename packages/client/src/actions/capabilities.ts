import type { Action, ActionRequest, ActionResult } from "../agent/types";

import { reviewEligibility } from "../commit-lifecycle";

export type ActionType = ActionRequest["type"];

export type ActionResultFor<Type extends ActionType> = Type extends "sign"
  ? Extract<ActionResult, { status: "signed" }>
  : Extract<ActionResult, { status: "submitted" }>;

export type ActionCapability<Type extends ActionType> = (
  request: Extract<ActionRequest, { type: Type }>,
  signal: AbortSignal,
) => Promise<ActionResultFor<Type>>;

export type ActionCapabilities = {
  [Type in ActionType]?: ActionCapability<Type>;
};

export const MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE =
  "Manual EVM execution signatures are unavailable because a fresh safety admission cannot be claimed.";

/** Ordinary execution Actions require a durable admission before wallet signing. */
export function requiresSignatureAdmission(request: ActionRequest): boolean {
  return (
    request.type === "sign" &&
    request.chainFamily === "evm" &&
    request.executionKind === "message" &&
    request.payloads.some(
      (payload) =>
        payload.kind === "evm_personal" || payload.kind === "evm_typed_data",
    )
  );
}

export function canExecute(
  action: Action,
  capabilities: ActionCapabilities,
): boolean {
  return (
    !(
      action.request.type === "execute_evm" && "commitStages" in action.request
    ) &&
    !requiresSignatureAdmission(action.request) &&
    Boolean(capabilities[action.request.type]) &&
    (!action.request.transactionSafety ||
      reviewEligibility(action.request)?.state === "eligible")
  );
}

export function execute(
  action: Action,
  capabilities: ActionCapabilities,
  signal: AbortSignal,
): Promise<ActionResult> {
  if (requiresSignatureAdmission(action.request))
    throw new Error(MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE);
  if (
    action.request.transactionSafety &&
    reviewEligibility(action.request)?.state !== "eligible"
  )
    throw new Error(
      "The reviewed transaction safety decision prevents a new wallet invocation",
    );
  switch (action.request.type) {
    case "execute_evm": {
      if ("commitStages" in action.request)
        throw new Error("Durable transactions must use Commit Service");
      const capability = capabilities.execute_evm;
      if (!capability) throw unsupported(action);
      return capability(action.request, signal);
    }
    case "execute_svm": {
      const capability = capabilities.execute_svm;
      if (!capability) throw unsupported(action);
      return capability(action.request, signal);
    }
    case "sign": {
      const capability = capabilities.sign;
      if (!capability) throw unsupported(action);
      return capability(action.request, signal);
    }
  }
}

function unsupported(action: Action): Error {
  return new Error(
    `No capability is configured for Action "${action.request.type}"`,
  );
}
