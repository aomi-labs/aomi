import type { Action, ActionRequest, Session } from "@aomi-labs/client";
import { useState } from "react";
import {
  decodeFunctionData,
  formatEther,
  formatUnits,
  type Abi,
  type Hex,
} from "viem";

import type { InjectedWallet } from "./injected-wallet";

export interface ActionReviewProps {
  session: Session;
  action: Action;
  wallet: InjectedWallet;
  /** Lower-case addresses; empty means "no allowlist configured". */
  allowedTargets: readonly string[];
  /** Used to decode calldata into a function name and arguments. */
  abi: Abi;
}

export interface EvmReviewProps {
  request: Extract<ActionRequest, { type: "execute_evm" }>;
  wallet: InjectedWallet;
  allowedTargets: readonly string[];
  abi: Abi;
  canExecute: boolean;
  busy: boolean;
  error?: string;
  title?: string;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Human-readable review of one agent Action, plus the page's own "verify
 * before sign" gate. Approve stays disabled until every check passes.
 */
export function ActionReview({
  session,
  action,
  wallet,
  allowedTargets,
  abi,
}: ActionReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = action.request;

  const decide = async (approve: boolean) => {
    if (approve) {
      const current = session.actions.get(action.id);
      if (!current || current.revision !== action.revision) {
        setError(
          "This request changed. Review the updated transaction before signing.",
        );
        return;
      }
    }
    setBusy(true);
    setError(undefined);
    // execute(): the SDK calls our wallet adapter (one wallet prompt per
    // call), then reports the transaction hashes back to the agent.
    // reject(): the agent is told the user declined, and the turn continues.
    try {
      await (approve
        ? session.actions.execute(action.id)
        : session.actions.reject(action.id, "Rejected by the user"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (action.state !== "pending") {
    const legs =
      action.result?.status === "submitted" ? action.result.legs : [];
    return (
      <article className="review resolved">
        <h3>
          {request.type} · {action.state}
        </h3>
        {action.result?.status === "rejected" && (
          <p className="muted">{action.result.reason}</p>
        )}
        <ul>
          {legs.map((leg) => (
            <li key={leg.id}>
              {leg.status} <code>{leg.transactionId ?? leg.reason}</code>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  if (request.type !== "execute_evm") {
    return (
      <article className="review">
        <h3>Unsupported request: {request.type}</h3>
        <p className="muted">
          This example only signs EVM transactions. Reject it to let the agent
          continue.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          Reject
        </button>
        {error && <p className="error">{error}</p>}
      </article>
    );
  }

  return (
    <EvmReview
      request={request}
      wallet={wallet}
      allowedTargets={allowedTargets}
      abi={abi}
      canExecute={session.actions.canExecute(action.id)}
      busy={busy}
      error={error}
      onApprove={() => void decide(true)}
      onReject={() => void decide(false)}
    />
  );
}

export function EvmReview({
  request,
  wallet,
  allowedTargets,
  abi,
  canExecute,
  busy,
  error,
  title = "Review transaction",
  onApprove,
  onReject,
}: EvmReviewProps) {
  const { transactions, simulation } = request;
  // Verify before sign. These run in the browser against the exact request
  // the wallet will be asked to sign; the server runs its own checks too.
  const checks = [
    {
      ok: simulation.status === "passed",
      label: `Simulation ${simulation.status}`,
    },
    {
      ok: transactions.every(
        (tx) => tx.from.toLowerCase() === wallet.address.toLowerCase(),
      ),
      label: "Built for the connected wallet",
    },
    ...(allowedTargets.length
      ? [
          {
            ok: transactions.every((tx) =>
              allowedTargets.includes(tx.to.toLowerCase()),
            ),
            label: "Every target is in VITE_ALLOWED_TARGETS",
          },
        ]
      : []),
    {
      ok: canExecute,
      label: "Wallet can execute this request",
    },
  ];
  const verified = checks.every((check) => check.ok);

  return (
    <article className="review">
      <h3>{title}</h3>

      <ol className="calls">
        {transactions.map((tx, index) => {
          let call: string;
          try {
            const { functionName, args } = decodeFunctionData({
              abi,
              data: tx.data as Hex,
            });
            call = `${functionName}(${(args ?? [])
              .map((arg) =>
                JSON.stringify(arg, (_, value: unknown) =>
                  typeof value === "bigint" ? value.toString() : value,
                ),
              )
              .join(", ")})`;
          } catch {
            call =
              !tx.data || tx.data === "0x"
                ? "Plain transfer (no calldata)"
                : `Unknown function ${tx.data.slice(0, 10)} (no matching ABI)`;
          }
          return (
            <li key={index}>
              <strong>{tx.label}</strong>
              <dl>
                <dt>To</dt>
                <dd>
                  <code>{tx.to}</code>
                </dd>
                <dt>Value</dt>
                <dd>{formatEther(BigInt(tx.value ?? "0"))} (native)</dd>
                <dt>Chain</dt>
                <dd>{tx.chain_id}</dd>
                <dt>Call</dt>
                <dd>
                  <code>{call}</code>
                </dd>
              </dl>
            </li>
          );
        })}
      </ol>

      <h4>Simulated balance changes</h4>
      {simulation.balanceChanges.length ? (
        <ul>
          {simulation.balanceChanges.map((change, index) => (
            <li key={index}>
              {change.direction === "out"
                ? "−"
                : change.direction === "in"
                  ? "+"
                  : ""}
              {change.decimals != null && /^-?\d+$/.test(change.amount)
                ? formatUnits(BigInt(change.amount), change.decimals)
                : change.amount}{" "}
              {change.symbol ?? change.asset}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None reported.</p>
      )}
      {simulation.warnings.map((warning) => (
        <p key={warning} className="warning">
          {warning}
        </p>
      ))}

      <h4>Verify before sign</h4>
      <ul className="checks">
        {checks.map((check) => (
          <li key={check.label} className={check.ok ? "ok" : "fail"}>
            {check.ok ? "✓" : "✗"} {check.label}
          </li>
        ))}
      </ul>

      <div className="buttons">
        <button type="button" disabled={busy || !verified} onClick={onApprove}>
          {busy ? "Waiting for wallet…" : "Approve & sign"}
        </button>
        <button type="button" disabled={busy} onClick={onReject}>
          Reject
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </article>
  );
}
