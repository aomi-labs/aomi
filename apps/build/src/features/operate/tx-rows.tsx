// Transactions table with etherscan-style row expansion. Submit-time fields
// render from today's payload; receipt fields (status detail, fee story,
// transfers, revert reason) light up when the confirmation watcher ships.
// EVM/SVM vocabulary flexes on the row's `family`.

import { Fragment } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, X } from "lucide-react";
import {
  chainLabel,
  secondsLabel,
  truncateAddress,
  valueLabel,
} from "./format";

type TxRow = Record<string, any>;

const STATUS_CHIP: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  submitted: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  failed: "bg-red-500/10 text-red-500 border-red-500/30",
  rejected: "bg-red-500/10 text-red-500 border-red-500/30",
  created: "bg-surface-subtle text-dim border-border",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3">
      <dt className="text-dim w-44 shrink-0 text-xs sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

function CopyBtn({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(value);
      }}
      className="text-dim hover:text-foreground ml-1.5 inline-flex align-middle"
      aria-label="Copy"
    >
      <Copy className="size-3" />
    </button>
  );
}

function statusDetail(tx: TxRow): string {
  const svm = tx.family === "svm";
  if (tx.status === "confirmed") {
    return svm && tx.slot != null
      ? `Finalized · slot ${tx.slot}`
      : tx.confirmations != null
        ? `Success · ${tx.confirmations} confirmations`
        : "Success";
  }
  if (tx.status === "submitted") {
    return svm ? "Processing · awaiting finality" : "Pending";
  }
  if (tx.status === "failed" || tx.status === "rejected") return "Reverted";
  return "Awaiting signature";
}

function TxDetail({ tx }: { tx: TxRow }) {
  const svm = tx.family === "svm";
  const payout = tx.kind === "partner_payout";
  return (
    <div className="bg-surface-subtle/50 grid gap-x-8 px-4 py-4 lg:grid-cols-[1fr_360px]">
      {/* Onchain facts */}
      <dl className="divide-border divide-y">
        <Field label={svm ? "Signature" : "Transaction hash"}>
          {tx.txHash ? (
            <>
              <Mono>{tx.txHash}</Mono>
              <CopyBtn value={String(tx.txHash)} />
            </>
          ) : (
            <span className="text-dim text-sm">
              not yet submitted — awaiting wallet signature
            </span>
          )}
        </Field>
        <Field label="Status">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP[String(tx.status)] ?? STATUS_CHIP.created}`}
          >
            {statusDetail(tx)}
          </span>
          {tx.revertReason ? (
            <div className="mt-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-500">
              {tx.revertReason}
            </div>
          ) : null}
        </Field>
        {tx.block || tx.slot ? (
          <Field label={svm ? "Slot" : "Block"}>
            <Mono>{tx.block ?? tx.slot}</Mono>
            <span className="text-dim ml-2 text-xs">
              {secondsLabel(tx.createdAt)}
            </span>
          </Field>
        ) : null}
        <Field label={payout ? "Payer" : "From"}>
          {tx.fromAddress ? (
            <>
              <Mono>{tx.fromAddress}</Mono>
              <CopyBtn value={String(tx.fromAddress)} />
            </>
          ) : (
            <span className="text-dim text-xs">not recorded</span>
          )}
          {tx.fromLabel ? (
            <span className="text-dim ml-2 text-xs">({tx.fromLabel})</span>
          ) : null}
        </Field>
        <Field label={svm ? "Program" : "Interacted with (To)"}>
          <Mono>{tx.toAddress}</Mono>
          <CopyBtn value={String(tx.toAddress ?? "")} />
          {tx.toLabel ? (
            <span className="text-dim ml-2 text-xs">({tx.toLabel})</span>
          ) : null}
        </Field>
        {Array.isArray(tx.transfers) && tx.transfers.length ? (
          <Field label={svm ? "Token transfers" : "ERC-20 transfers"}>
            <div className="space-y-1">
              {tx.transfers.map((transfer: string) => (
                <div key={transfer} className="font-mono text-xs">
                  {transfer}
                </div>
              ))}
            </div>
          </Field>
        ) : null}
        <Field label={payout ? "Settlement amount" : "Value"}>
          <span className="font-medium">{valueLabel(tx.value)}</span>
          {tx.valueUsd ? (
            <span className="text-dim ml-2 text-xs">{tx.valueUsd}</span>
          ) : null}
        </Field>
        {tx.txFee ? (
          <Field label="Transaction fee">
            <span className="font-medium">{tx.txFee}</span>
            <span className="text-dim ml-2 text-xs">
              {svm
                ? [
                    tx.computeUnits &&
                      `${tx.computeUnits} CU of ${tx.computeLimit ?? "—"}`,
                    tx.priorityFee && `priority ${tx.priorityFee}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : [
                    tx.gasUsed &&
                      `${tx.gasUsed} gas used of ${tx.gasLimit ?? "—"}`,
                    tx.effGasPrice,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          </Field>
        ) : null}
        {tx.platformFee ? (
          <Field label="Platform fee">
            <span className="font-medium">{tx.platformFee}</span>
          </Field>
        ) : null}
        {tx.nonce != null && !svm ? (
          <Field label="Nonce">
            <Mono>{tx.nonce}</Mono>
          </Field>
        ) : null}
        {tx.method ? (
          <Field label={svm ? "Instruction" : "Method"}>
            <Mono>{tx.method}</Mono>
          </Field>
        ) : null}
        {tx.calldataPreview ? (
          <Field label={svm ? "Instruction data" : "Calldata"}>
            <div className="border-border bg-surface max-h-20 overflow-y-auto rounded-md border px-2.5 py-2">
              <Mono>{tx.calldataPreview}</Mono>
            </div>
          </Field>
        ) : null}
      </dl>

      {/* Agent context — what no explorer can show */}
      <div className="mt-4 lg:mt-0">
        <div className="border-border bg-surface rounded-md border">
          <div className="border-border text-dim border-b px-3 py-2 text-xs font-medium uppercase">
            {payout ? "Partner payment context" : "Agent context"}
          </div>
          <dl className="px-3 py-2">
            <Field label="App">
              <span className="font-medium">{tx.application}</span>
            </Field>
            {payout ? (
              <>
                <Field label="Ledger scope">
                  <span className="text-dim text-xs">
                    recipient bucket · may settle more than one priced call
                  </span>
                </Field>
                <Field label="Credits cleared">
                  <span className="font-mono text-xs">
                    {Number(tx.payment?.credits ?? 0).toFixed(2)}
                  </span>
                </Field>
              </>
            ) : (
              <Field label="User intent">
                {/* Privacy ruling: intent-level content is never shown to builders. */}
                <span className="text-dim text-xs">hidden · user privacy</span>
              </Field>
            )}
            <Field label="External tx id">
              <Mono>{tx.externalTxId}</Mono>
            </Field>
          </dl>
        </div>
        {tx.explorerUrl ? (
          <a
            href={String(tx.explorerUrl)}
            target="_blank"
            rel="noreferrer"
            className="border-border bg-surface hover:bg-accent-hover mt-2 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm"
          >
            View on explorer <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function TransactionRows({
  rows,
  apps,
  appFilter,
  onAppFilterChange,
  openId,
  onToggle,
}: {
  rows: TxRow[];
  apps: string[];
  appFilter: string | null;
  onAppFilterChange: (app: string | null) => void;
  openId: string | null;
  onToggle: (id: string | null) => void;
}) {
  const visible = rows.filter(
    (tx) => !appFilter || tx.application === appFilter,
  );
  return (
    <div className="space-y-3">
      <div className="border-border bg-surface-subtle flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
        <select
          value={appFilter ?? ""}
          onChange={(event) => onAppFilterChange(event.target.value || null)}
          className="border-border bg-surface text-foreground h-8 rounded-md border px-2 text-xs"
        >
          <option value="">All apps</option>
          {apps.map((app) => (
            <option key={app} value={app}>
              {app}
            </option>
          ))}
        </select>
        {appFilter ? (
          <button
            type="button"
            onClick={() => onAppFilterChange(null)}
            className="text-dim hover:text-foreground flex items-center gap-1 text-xs"
          >
            <X className="size-3" /> clear filter
          </button>
        ) : null}
        <span className="text-dim ml-auto text-xs">
          {visible.length} records
        </span>
      </div>
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="divide-border w-full min-w-[960px] table-fixed divide-y text-sm">
          <thead className="bg-surface-subtle text-dim text-left text-xs uppercase">
            <tr>
              <th className="w-8 px-3 py-2" aria-label="expand" />
              <th className="w-44 px-3 py-2">Time</th>
              <th className="w-44 px-3 py-2">App</th>
              <th className="w-24 px-3 py-2">Status</th>
              <th className="w-28 px-3 py-2">Chain</th>
              <th className="w-28 px-3 py-2">From</th>
              <th className="w-28 px-3 py-2">To</th>
              <th className="w-24 px-3 py-2">Value</th>
              <th className="px-3 py-2">Description</th>
              <th className="w-28 px-3 py-2">Hash</th>
            </tr>
          </thead>
          <tbody className="divide-border bg-surface divide-y">
            {visible.map((tx) => {
              const open = openId === tx.id;
              return (
                <Fragment key={tx.id}>
                  <tr
                    onClick={() => onToggle(open ? null : String(tx.id))}
                    className="hover:bg-surface-subtle cursor-pointer"
                  >
                    <td className="text-dim px-3 py-2">
                      {open ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </td>
                    <td className="text-dim whitespace-nowrap px-3 py-2">
                      {secondsLabel(tx.createdAt)}
                    </td>
                    <td className="min-w-0 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={tx.application}>
                          {tx.application}
                        </span>
                        {tx.kind === "partner_payout" ? (
                          <span
                            aria-label="Partner payout"
                            className="border-border bg-surface-subtle text-dim shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase"
                          >
                            Payout
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_CHIP[String(tx.status)] ?? STATUS_CHIP.created}`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td
                      className="truncate whitespace-nowrap px-3 py-2"
                      title={chainLabel(tx)}
                    >
                      {chainLabel(tx)}
                    </td>
                    <td
                      className="max-w-36 truncate px-3 py-2 font-mono text-xs"
                      title={String(tx.fromAddress ?? "")}
                    >
                      {truncateAddress(tx.fromAddress)}
                    </td>
                    <td
                      className="max-w-36 truncate px-3 py-2 font-mono text-xs"
                      title={String(tx.toAddress ?? "")}
                    >
                      {truncateAddress(tx.toAddress)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                      {valueLabel(tx.value)}
                    </td>
                    <td
                      className="max-w-56 truncate px-3 py-2 text-xs"
                      title={String(tx.description ?? "")}
                    >
                      {tx.description ? String(tx.description) : "—"}
                    </td>
                    <td
                      className="max-w-36 truncate px-3 py-2 font-mono text-xs"
                      title={String(tx.txHash ?? "")}
                    >
                      {tx.txHash ? truncateAddress(tx.txHash) : "—"}
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={10} className="p-0">
                        <TxDetail tx={tx} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
