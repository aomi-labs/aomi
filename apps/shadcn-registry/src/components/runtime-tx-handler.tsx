"use client";

import { ShieldCheck } from "lucide-react";
import type { Action, ActionRequest } from "@aomi-labs/client";
import { normalizeSolanaCluster } from "@aomi-labs/client";
import { useAomiRuntime } from "@aomi-labs/react";

import { useAomiWalletKit } from "../lib/wallet-kit";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type Call = { to?: string; value?: string; data?: string };
type Fee = { asset?: unknown; amount?: string; recipient?: string };

/** Presents the next durable Action and submits only an explicit user choice. */
export function RuntimeTxHandler() {
  const {
    pendingActions,
    actionAttempts,
    events,
    turnState,
    executeAction,
    rejectAction,
    showNotification,
  } = useAomiRuntime();
  const wallet = useAomiWalletKit();
  const action = pendingActions[0];
  const lastAction = events.findLast(
    (event): event is Action => event.type === "action",
  );
  const displayedAction =
    action ??
    (turnState === "awaiting_action" || turnState === "processing"
      ? lastAction
      : undefined);
  const attempt = action ? actionAttempts.get(action.id) : undefined;
  const approving =
    attempt?.state === "executing" || attempt?.state === "responding";

  const decide = async (approved: boolean) => {
    if (!action || approving) return;
    try {
      if (approved) await executeAction(action.id);
      else await rejectAction(action.id, "Request rejected");
    } catch (error) {
      showNotification({
        type: "error",
        title:
          error instanceof Error ? error.message : "Action response failed",
        duration: 6000,
      });
    }
  };

  if (!action) {
    return displayedAction ? (
      <ActionEventCard action={displayedAction} turnState={turnState} />
    ) : null;
  }
  const request = action.request;
  const chainName = actionNetwork(request, wallet.supportedChains);
  const calls =
    request.type === "sign" ? (request.calls ?? []).filter(isCall) : [];
  const fees =
    request.type === "sign" ? (request.fees ?? []).filter(isFee) : [];

  return (
    <Dialog open onOpenChange={(open) => !open && void decide(false)}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <div className="bg-primary/10 text-primary mb-1 flex size-10 items-center justify-center rounded-full">
            <ShieldCheck className="size-5" />
          </div>
          <DialogTitle>Review action</DialogTitle>
          <DialogDescription>
            Review the exact request and its simulation before your wallet is
            invoked.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted/40 grid gap-3 rounded-xl border p-4 text-sm">
          <Fact label="Network" value={chainName} />
          {request.type === "sign" ? (
            <Fact label="Account" value={compact(request.signer)} mono />
          ) : null}
          <Fact
            label="Operations"
            value={String(actionOperationCount(request))}
          />
          {calls.map((call, index) => (
            <div
              key={index}
              className="bg-background rounded-lg border p-3 text-xs"
            >
              <p className="mb-1 font-medium">Call {index + 1}</p>
              <p className="break-all font-mono">To: {call.to}</p>
              <p className="break-all font-mono">Value: {call.value}</p>
              <p className="break-all font-mono">Data: {call.data ?? "0x"}</p>
            </div>
          ))}
          {fees.map((fee, index) => (
            <div
              key={index}
              className="bg-background rounded-lg border p-3 text-xs"
            >
              <p className="break-all font-mono">
                Asset: {feeAssetLabel(fee.asset)}
              </p>
              <p className="break-all font-mono">Amount: {fee.amount}</p>
              <p className="break-all font-mono">Recipient: {fee.recipient}</p>
            </div>
          ))}
          <ActionSimulationSummary request={request} />
          <ActionRequestPayload request={request} />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void decide(false)}
            disabled={approving}
          >
            Reject
          </Button>
          <Button onClick={() => void decide(true)} disabled={approving}>
            {approving ? "Waiting for wallet…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionEventCard({
  action,
  turnState,
}: {
  action: Action;
  turnState: string | undefined;
}) {
  return (
    <aside
      data-testid="action-event-card"
      data-action-id={action.id}
      data-turn-state={turnState}
      className="border-aomi-border bg-aomi-raised text-aomi-fg absolute bottom-4 right-4 z-50 w-[min(32rem,calc(100%-2rem))] rounded-xl border p-4 shadow-xl"
    >
      <p className="text-sm font-medium">
        {turnState === "awaiting_action"
          ? "Awaiting action"
          : "Executing action"}
      </p>
      <p className="text-aomi-muted mt-1 text-xs">
        {action.request.type} · revision {action.revision}
      </p>
      <ActionRequestPayload request={action.request} />
    </aside>
  );
}

function ActionRequestPayload({ request }: { request: ActionRequest }) {
  return (
    <pre
      data-testid="action-request-payload"
      className="bg-aomi-surface-2 mt-3 max-h-48 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed"
    >
      {JSON.stringify(request, null, 2)}
    </pre>
  );
}

function ActionSimulationSummary({ request }: { request: ActionRequest }) {
  if (request.type === "sign" || !request.simulation) return null;
  const simulation = request.simulation;
  return (
    <section
      data-testid="action-simulation"
      data-status={simulation.status}
      className="bg-background rounded-lg border p-3 text-xs"
    >
      <p className="font-medium">Simulation: {simulation.status}</p>
      {simulation.gas?.units ? <p>Gas units: {simulation.gas.units}</p> : null}
      {simulation.balanceChanges.map((change, index) => (
        <p key={`${change.asset}-${index}`}>
          {change.direction ?? "change"}: {change.amount}{" "}
          {change.symbol ?? change.asset}
        </p>
      ))}
      {simulation.warnings.map((warning) => (
        <p key={warning} className="text-destructive">
          {warning}
        </p>
      ))}
    </section>
  );
}

function actionNetwork(
  request: ActionRequest,
  supportedChains: readonly { id: number; name: string }[] | undefined,
): string {
  switch (request.type) {
    case "execute_evm": {
      const chainId = request.transactions[0]?.chain_id;
      return (
        supportedChains?.find((chain) => chain.id === chainId)?.name ??
        (chainId ? `Chain ${chainId}` : "EVM")
      );
    }
    case "execute_svm": {
      const cluster = request.transactions[0]?.cluster;
      return normalizeSolanaCluster(cluster) ?? cluster ?? "Solana";
    }
    case "sign":
      return request.chainFamily === "svm"
        ? (normalizeSolanaCluster(request.cluster) ??
            request.cluster ??
            "Solana")
        : (supportedChains?.find((chain) => chain.id === request.chainId)
            ?.name ?? (request.chainId ? `Chain ${request.chainId}` : "EVM"));
  }
}

function actionOperationCount(request: ActionRequest): number {
  switch (request.type) {
    case "execute_evm":
    case "execute_svm":
      return request.transactions.length;
    case "sign":
      return request.calls?.length || request.payloads.length || 1;
  }
}

function compact(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}

function isCall(value: unknown): value is Call {
  return typeof value === "object" && value !== null;
}

function isFee(value: unknown): value is Fee {
  return typeof value === "object" && value !== null;
}

function feeAssetLabel(asset: unknown): string {
  if (typeof asset !== "object" || asset === null) return "Unknown asset";
  if (!("kind" in asset)) return "Unknown asset";
  if (asset.kind === "native") return "Native";
  return asset.kind === "token" &&
    "address" in asset &&
    typeof asset.address === "string"
    ? asset.address
    : "Unknown asset";
}
