/** The Mini App is one four-stage ceremony: verify Telegram, link the wallet,
 *  delegate signing, sign the permit. Which stage is showing, what it says, and
 *  which failure wins are decided here as pure functions over the hook states,
 *  because that decision has regressed twice — a later progress message
 *  painting over an earlier error is invisible in review and indistinguishable
 *  from a hang in production. */

export type StageState = "pending" | "active" | "done" | "error";

export type CeremonyInput = {
  launch: { status: "loading" | "ready" | "error"; error: string | null };
  auth: { phase: string; error: string | null; readyForExchange: boolean };
  account: { status: string; error: string | null };
  delegation: { status: string; error: string | null };
  permission: {
    status: string;
    error: string | null;
    mode: string | null;
  };
};

export type FailureSource =
  | "permission"
  | "delegation"
  | "account"
  | "auth"
  | "launch";

/** The deepest stage that failed wins, and every failure beats every progress
 *  message. An error is the only thing the person can act on. */
export function resolveFailure(
  input: CeremonyInput,
): { source: FailureSource; code: string } | null {
  if (input.permission.error) {
    return { source: "permission", code: input.permission.error };
  }
  if (input.delegation.error) {
    return { source: "delegation", code: input.delegation.error };
  }
  if (input.account.status === "error" && input.account.error) {
    return { source: "account", code: input.account.error };
  }
  if (input.auth.phase === "error") {
    return {
      source: "auth",
      code: input.auth.error ?? "telegram_custom_auth_failed",
    };
  }
  if (input.launch.status === "error") {
    return { source: "launch", code: input.launch.error ?? "invalid_telegram_launch" };
  }
  return null;
}

export function resolveStageStates(input: CeremonyInput): {
  connect: StageState;
  link: StageState;
  delegate: StageState;
  permit: StageState;
} {
  const linked = input.account.status === "ready";
  const delegated = input.delegation.status === "done";
  return {
    connect:
      input.launch.status === "error" || input.auth.phase === "error"
        ? "error"
        : input.auth.readyForExchange
          ? "done"
          : "active",
    link:
      input.account.status === "error"
        ? "error"
        : linked
          ? "done"
          : input.auth.readyForExchange
            ? "active"
            : "pending",
    delegate:
      input.delegation.status === "error"
        ? "error"
        : delegated
          ? "done"
          : input.delegation.status === "delegating"
            ? "active"
            : "pending",
    permit:
      input.permission.status === "error"
        ? "error"
        : input.permission.status === "done"
          ? "done"
          : input.permission.status === "signing"
            ? "active"
            : "pending",
  };
}

/** The single action available right now. Only one stage is ever actionable, so
 *  the page never asks the user which button is the real one. */
export function resolveAction(
  input: CeremonyInput,
): "delegate" | "sign" | null {
  if (resolveFailure(input)) return null;
  if (input.account.status !== "ready") return null;
  if (input.delegation.status === "ready") return "delegate";
  if (input.delegation.status === "done" && input.permission.status === "ready") {
    return "sign";
  }
  return null;
}

export function resolveHeadline(input: CeremonyInput): string {
  const linked = input.account.status === "ready";
  const delegated = input.delegation.status === "done";
  if (input.permission.status === "done") return "All set. Return to Telegram.";
  if (delegated && input.permission.status === "ready") {
    return "Review the permission below, then sign it.";
  }
  if (linked && !delegated) {
    return "Aomi needs permission to sign with your wallet.";
  }
  switch (input.auth.phase) {
    case "choose":
      return "Choose how to access your wallet.";
    case "email":
      return "Use the email linked to your existing wallet.";
    case "confirm":
      return "Confirm that this Telegram account can use your wallet.";
    default:
      return linked ? "Your wallet is linked." : "Setting up your wallet…";
  }
}
