"use client";

import { useSvmWalletBinding } from "./use-svm-wallet-binding";

export function SvmWalletBinding() {
  const { state, binding, canBind, bind } = useSvmWalletBinding();
  if (state.status === "no-wallet") return null;

  const action =
    state.status === "unbound"
      ? "Bind wallet"
      : state.status === "error"
        ? "Try binding again"
        : null;

  return (
    <div
      className="border-aomi-border bg-aomi-raised text-aomi-fg rounded-card flex min-w-0 flex-col gap-3 border p-4"
      data-testid="svm-wallet-binding"
    >
      <div className="flex flex-col gap-0.5">
        <p className="type-row">Solana signing</p>
        <p className="type-meta text-aomi-muted">{describe(state)}</p>
      </div>
      {action && (
        <button
          type="button"
          disabled={!canBind || binding}
          onClick={() => void bind()}
          className="bg-aomi-fg text-aomi-bg rounded-control type-control inline-flex h-8 items-center justify-center self-start whitespace-nowrap px-3 font-medium transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          {binding ? "Waiting for signature…" : action}
        </button>
      )}
    </div>
  );
}

function describe(
  state: ReturnType<typeof useSvmWalletBinding>["state"],
): string {
  switch (state.status) {
    case "loading":
      return "Checking whether this wallet is bound…";
    case "bound":
      return `Bound to your account (signing mode: ${state.signingMode}).`;
    case "unbound":
      return "This Solana wallet is not bound yet. Sign one message to enable transaction approvals.";
    case "error":
      return `Could not check the binding: ${state.message}`;
    default:
      return "";
  }
}
