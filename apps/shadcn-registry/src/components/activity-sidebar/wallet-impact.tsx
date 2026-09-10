"use client";
import { useTokenMetadata } from "./token-metadata";
import { useState } from "react";
import type { ActionRequest } from "@aomi-labs/client";
import { cn, getChainInfo } from "@aomi-labs/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  ChevronLeft,
  ChevronRight,
  Coins,
  Gem,
  Info,
  KeyRound,
} from "lucide-react";
import {
  type Simulation,
  type BalanceChange,
  type ApprovalChange,
  type TransactionIcon,
  type SupportedChain,
  pageRangeLabel,
  isRevokedApproval,
  firstEvmChainId,
  assetFallback,
  balanceChangeNetwork,
  assetChangePresentation,
  formatAssetAmount,
  approvalTitle,
  approvalScope,
  compact,
} from "./presentation";
const REVIEW_PAGE_SIZE = 2;

function ReviewPager({
  current,
  total,
  label,
  onMove,
  subject,
}: {
  current: number;
  total: number;
  label: string;
  onMove: (direction: -1 | 1) => void;
  subject: string;
}) {
  return (
    <div className="border-aomi-border bg-aomi-raised flex h-7 shrink-0 items-center rounded-full border p-0.5">
      <button
        type="button"
        onClick={() => onMove(-1)}
        aria-label={`Previous ${subject}`}
        className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-6 items-center justify-center rounded-full transition-colors"
      >
        <ChevronLeft className="size-3" />
      </button>
      <span className="text-aomi-muted min-w-[66px] text-center text-[9px] tabular-nums">
        {label || `${current + 1} of ${total}`}
      </span>
      <button
        type="button"
        onClick={() => onMove(1)}
        aria-label={`Next ${subject}`}
        className="text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-6 items-center justify-center rounded-full transition-colors"
      >
        <ChevronRight className="size-3" />
      </button>
    </div>
  );
}

export function ImpactPanel({
  request,
  balanceChanges,
  approvals,
  supportedChains,
  showNetwork,
  failed,
}: {
  request: ActionRequest;
  balanceChanges: Simulation["balanceChanges"];
  approvals: Simulation["approvals"];
  supportedChains?: readonly SupportedChain[];
  showNetwork: boolean;
  failed: boolean;
}) {
  const [page, setPage] = useState(0);
  const entries: Array<
    | { type: "balance"; value: BalanceChange }
    | { type: "approval"; value: ApprovalChange }
  > = [
    ...balanceChanges.map((value) => ({ type: "balance" as const, value })),
    ...approvals.map((value) => ({ type: "approval" as const, value })),
  ];
  const pages = Math.max(1, Math.ceil(entries.length / REVIEW_PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const shown = entries.slice(
    safePage * REVIEW_PAGE_SIZE,
    safePage * REVIEW_PAGE_SIZE + REVIEW_PAGE_SIZE,
  );
  const heading =
    balanceChanges.length && approvals.length
      ? "Wallet changes"
      : balanceChanges.length
        ? "Balance changes"
        : approvals.length
          ? "Permission changes"
          : "Wallet changes";
  const move = (direction: -1 | 1) =>
    setPage((current) => (current + direction + pages) % pages);

  return (
    <section
      aria-label="Simulated wallet impact"
      data-change-count={balanceChanges.length}
      data-approval-count={approvals.length}
      className={cn("bg-aomi-surface flex min-w-0 flex-col rounded-[14px] p-3")}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <p className="text-aomi-muted flex-1 text-[12px] font-medium">
          {heading}
        </p>
        {pages > 1 ? (
          <ReviewPager
            current={safePage}
            total={pages}
            label={pageRangeLabel(
              safePage * REVIEW_PAGE_SIZE,
              shown.length,
              entries.length,
            )}
            onMove={move}
            subject="wallet impact page"
          />
        ) : null}
      </div>
      <div className={cn(failed && "opacity-50")}>
        {shown.map((entry, index) =>
          entry.type === "balance" ? (
            <AssetChange
              key={`${entry.value.asset}-${entry.value.tokenId ?? "fungible"}-${entry.value.direction}-${index}`}
              change={entry.value}
              request={request}
              supportedChains={supportedChains}
              showNetwork={showNetwork}
            />
          ) : (
            <ApprovalEffect
              key={`${entry.value.asset}-${entry.value.kind}-${entry.value.tokenId ?? "all"}-${index}`}
              approval={entry.value}
              request={request}
              supportedChains={supportedChains}
            />
          ),
        )}
        {shown.length === 0 ? (
          <div className="flex items-start gap-3 px-1 py-2">
            <span className="border-aomi-border bg-aomi-raised text-aomi-muted flex size-8 shrink-0 items-center justify-center rounded-full border">
              <Info className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-medium">
                {request.type === "sign"
                  ? "Signature only"
                  : failed
                    ? "No wallet changes simulated"
                    : "Wallet changes unavailable"}
              </p>
              <p className="text-aomi-muted text-[11px] leading-4">
                {request.type === "sign"
                  ? "Review the full signing request below."
                  : failed
                    ? "The request reverted before effects were produced."
                    : "Review the transaction details in your wallet."}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AssetChange({
  change,
  request,
  supportedChains,
  showNetwork,
}: {
  change: BalanceChange;
  request: ActionRequest;
  supportedChains?: readonly SupportedChain[];
  showNetwork: boolean;
}) {
  const incoming = change.direction === "in";
  const outgoing = change.direction === "out";
  const chainId = change.chainId ?? firstEvmChainId(request);
  const fungible =
    change.asset !== "native" &&
    !change.tokenId &&
    (change.standard == null || change.standard === "erc20");
  const { metadata, loading } = useTokenMetadata(
    supportedChains?.find((chain) => chain.id === chainId),
    change.asset,
    fungible && (!change.symbol?.trim() || change.decimals == null),
  );
  const nativeSymbol =
    request.type === "execute_svm"
      ? "SOL"
      : chainId
        ? (supportedChains?.find((chain) => chain.id === chainId)
            ?.nativeCurrency?.symbol ?? getChainInfo(chainId)?.ticker)
        : undefined;
  const symbol =
    (change.symbol?.trim() || metadata?.symbol) ??
    (change.asset === "native" ? nativeSymbol : undefined) ??
    assetFallback(change.asset);
  const decimals =
    change.decimals ??
    metadata?.decimals ??
    (change.asset === "native"
      ? request.type === "execute_svm"
        ? 9
        : 18
      : undefined);
  const network = balanceChangeNetwork(change, request, supportedChains);
  const presentation = assetChangePresentation(change, symbol, decimals);
  const assetName =
    change.asset !== "native" &&
    !change.tokenId &&
    change.name?.trim() &&
    change.name.trim().toLocaleLowerCase() !== symbol.toLocaleLowerCase()
      ? change.name.trim()
      : undefined;
  const context = [assetName, showNetwork ? network : undefined]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return (
    <div
      data-testid="asset-effect"
      className="flex min-w-0 items-center gap-3 px-1 py-3"
    >
      <AssetMark
        standard={change.standard}
        symbol={symbol}
        incoming={incoming}
      />
      {!change.tokenId &&
      change.standard !== "erc721" &&
      change.standard !== "erc1155" ? (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium" title={symbol}>
              {symbol}
            </p>
            <p className="text-aomi-muted mt-0.5 truncate text-[11px]">
              {context || presentation.verb}
            </p>
          </div>
          <p
            className={cn(
              "max-w-[55%] break-all text-right text-[14px] font-medium tabular-nums",
              incoming
                ? "text-aomi-success"
                : outgoing
                  ? "text-aomi-danger"
                  : "text-aomi-fg",
            )}
            aria-label={
              decimals == null && /^\d+$/.test(change.amount)
                ? `${change.amount} raw units; token decimals unavailable`
                : presentation.value
            }
          >
            {decimals == null && /^\d+$/.test(change.amount) ? (
              <span className="text-aomi-muted text-[11px] font-normal">
                {loading ? "Loading amount…" : "Amount unavailable"}
              </span>
            ) : (
              <>
                {incoming ? "+" : outgoing ? "−" : ""}
                {formatAssetAmount(change.amount, decimals)}
                <span className="sr-only"> {symbol}</span>
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-aomi-muted text-[11px] font-medium uppercase leading-4 tracking-[0.08em]">
              {presentation.verb}
              {context ? (
                <span className="ml-1 normal-case tracking-normal">
                  · {context}
                </span>
              ) : null}
            </p>
            <p
              className={cn(
                "truncate text-[13px] font-medium tabular-nums leading-5",
                incoming
                  ? "text-aomi-success"
                  : outgoing
                    ? "text-aomi-danger"
                    : "text-aomi-fg",
              )}
            >
              {presentation.value}
            </p>
            {presentation.detail ? (
              <p className="text-aomi-muted leading-3.5 truncate text-[10px]">
                {presentation.detail}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function AssetMark({
  standard,
  symbol,
  incoming,
}: {
  standard?: BalanceChange["standard"];
  symbol: string;
  incoming: boolean;
}) {
  const Direction = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      aria-hidden="true"
      data-asset-icon={
        standard === "native" && symbol.toUpperCase() === "ETH"
          ? "eth"
          : standard === "erc721" || standard === "erc1155"
            ? "nft"
            : "coin"
      }
      className={cn(
        "border-aomi-border/60 bg-aomi-raised relative flex size-8 shrink-0 items-center justify-center rounded-full border",
        incoming ? "text-aomi-success" : "text-aomi-danger",
      )}
    >
      {standard === "native" && symbol.toUpperCase() === "ETH" ? (
        <EthereumAssetIcon className="size-[17px]" />
      ) : standard === "erc721" || standard === "erc1155" ? (
        <Gem className="size-[16px]" strokeWidth={1.7} />
      ) : (
        <Coins className="size-[16px]" strokeWidth={1.7} />
      )}
      <span className="bg-aomi-raised ring-aomi-raised absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full ring-1">
        <Direction className="size-2.5" strokeWidth={2.5} />
      </span>
    </span>
  );
}

const EthereumAssetIcon: TransactionIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path
      d="m12 2.25-6.1 10.1L12 15.9l6.1-3.55L12 2.25Z"
      fill="currentColor"
      opacity=".9"
    />
    <path
      d="m5.9 13.55 6.1 8.2 6.1-8.2L12 17.1l-6.1-3.55Z"
      fill="currentColor"
      opacity=".58"
    />
  </svg>
);

function ApprovalEffect({
  approval,
  request,
  supportedChains,
}: {
  approval: ApprovalChange;
  request: ActionRequest;
  supportedChains?: readonly SupportedChain[];
}) {
  const revoked = isRevokedApproval(approval);
  const symbol =
    approval.symbol ?? approval.name ?? assetFallback(approval.asset);
  const network = approval.chainId
    ? (supportedChains?.find((chain) => chain.id === approval.chainId)?.name ??
      `Chain ${approval.chainId}`)
    : balanceChangeNetwork(
        { asset: approval.asset, amount: "0" },
        request,
        supportedChains,
      );
  const title = approvalTitle(approval, symbol);
  const scope = approvalScope(approval);

  return (
    <div
      data-testid="approval-effect"
      className="flex min-w-0 items-center gap-3 px-1 py-3"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border",
          revoked
            ? "border-aomi-success/15 bg-aomi-success/8 text-aomi-success"
            : approval.unlimited
              ? "border-aomi-warning/20 bg-aomi-warning/10 text-aomi-warning"
              : "border-aomi-accent/15 bg-aomi-accent-subtle text-aomi-accent-strong",
        )}
      >
        {revoked ? (
          <Ban className="size-3.5" strokeWidth={2} />
        ) : (
          <KeyRound className="size-3.5" strokeWidth={1.9} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-aomi-muted text-[10px] font-medium uppercase tracking-[0.08em]">
          {revoked ? "Permission removed" : "Permission requested"}
          {network ? (
            <span className="ml-1 normal-case tracking-normal">
              · {network}
            </span>
          ) : null}
        </p>
        <p
          className={cn(
            "truncate text-[13px] font-medium leading-5",
            approval.unlimited && !revoked
              ? "text-aomi-warning"
              : "text-aomi-fg",
          )}
          title={title}
        >
          {title}
        </p>
        <p className="text-aomi-muted leading-3.5 truncate text-[10px]">
          {scope} · To {compact(approval.spender)}
        </p>
      </div>
    </div>
  );
}
