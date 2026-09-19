import type { Action, ActionRequest, ActionResult } from "../agent/types";

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

export function canExecute(
  action: Action,
  capabilities: ActionCapabilities,
): boolean {
  return Boolean(capabilities[action.request.type]);
}

export function execute(
  action: Action,
  capabilities: ActionCapabilities,
  signal: AbortSignal,
): Promise<ActionResult> {
  switch (action.request.type) {
    case "execute_evm": {
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
