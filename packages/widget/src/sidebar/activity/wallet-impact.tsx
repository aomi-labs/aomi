"use client";
import { cn } from "@/lib/cn";
import { useTokenMetadata } from "./token-metadata";
import { LoadingLine } from "@/ui/aomi/loading-pane";
import { useState } from "react";
import type {
  ActionRequest,
  MessageReview,
  MessageReviewRow,
} from "@aomi-labs/client";
import { getChainInfo } from "@aomi-labs/react";
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
  LogIn,
  PenLine,
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
  focusRing,
} from "./presentation";
import { shortAddress } from "@aomi-labs/client";
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
        className={cn(
          focusRing,
          "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-6 items-center justify-center rounded-full transition-colors",
        )}
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
        className={cn(
          focusRing,
          "text-aomi-muted hover:bg-aomi-hover hover:text-aomi-fg flex size-6 items-center justify-center rounded-full transition-colors",
        )}
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
  message,
  supportedChains,
  showNetwork,
  failed,
}: {
  request: ActionRequest;
  balanceChanges: Simulation["balanceChanges"];
  approvals: Simulation["approvals"];
  /** A message commit's decoded rows, in place of simulated changes. */
  message?: MessageReview;
  supportedChains?: readonly SupportedChain[];
  showNetwork: boolean;
  failed: boolean;
}) {
  const [page, setPage] = useState(0);
  const entries: Array<
    | { type: "balance"; value: BalanceChange }
    | { type: "approval"; value: ApprovalChange }
    | { type: "message"; value: MessageReviewRow }
  > = message
    ? message.rows.map((value) => ({ type: "message" as const, value }))
    : [
        ...balanceChanges.map((value) => ({
          type: "balance" as const,
          value,
        })),
        ...approvals.map((value) => ({ type: "approval" as const, value })),
      ];
  const pages = Math.max(1, Math.ceil(entries.length / REVIEW_PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const shown = entries.slice(
    safePage * REVIEW_PAGE_SIZE,
    safePage * REVIEW_PAGE_SIZE + REVIEW_PAGE_SIZE,
  );
  const heading = message
    ? messageHeading(message)
    : balanceChanges.length && approvals.length
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
      aria-label={message ? "Message impact" : "Simulated wallet impact"}
      data-change-count={balanceChanges.length}
      data-approval-count={approvals.length}
      className="bg-aomi-surface rounded-card flex min-w-0 flex-col p-3"
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <p className="type-meta text-aomi-muted flex-1 font-medium">
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
          ) : entry.type === "approval" ? (
            <ApprovalEffect
              key={`${entry.value.asset}-${entry.value.kind}-${entry.value.tokenId ?? "all"}-${index}`}
              approval={entry.value}
              request={request}
              supportedChains={supportedChains}
            />
          ) : (
            <MessageEffect
              key={`${entry.value.kind}-${safePage}-${index}`}
              row={entry.value}
              tokens={message?.tokens}
            />
          ),
        )}
        {shown.length === 0 ? (
          <div className="flex items-start gap-3 px-1 py-2">
            <span className="border-aomi-border bg-aomi-raised text-aomi-muted flex size-8 shrink-0 items-center justify-center rounded-full border">
              <Info className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="type-meta font-medium">
                {request.type === "sign"
                  ? "Signature only"
                  : failed
                    ? "No wallet changes simulated"
                    : "Wallet changes unavailable"}
              </p>
              <p className="type-meta text-aomi-muted">
                {message
                  ? "Review the message below."
                  : request.type === "sign"
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
            <p className="type-control truncate font-medium" title={symbol}>
              {symbol}
            </p>
            <p className="type-meta text-aomi-muted mt-0.5 truncate">
              {context || presentation.verb}
            </p>
          </div>
          <p
            className={cn(
              "type-meta max-w-[60%] whitespace-nowrap text-right font-medium tabular-nums",
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
              loading ? (
                <LoadingLine className="w-14" />
              ) : (
                <span className="text-aomi-muted font-normal">
                  Amount unavailable
                </span>
              )
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
            <p className="type-eyebrow text-aomi-muted">
              {presentation.verb}
              {context ? (
                <span className="ml-1 normal-case tracking-normal">
                  · {context}
                </span>
              ) : null}
            </p>
            <p
              className={cn(
                "type-control truncate font-medium tabular-nums",
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
              <p className="type-meta text-aomi-muted truncate">
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
        <p className="type-eyebrow text-aomi-muted">
          {revoked ? "Permission removed" : "Permission requested"}
          {network ? (
            <span className="ml-1 normal-case tracking-normal">
              · {network}
            </span>
          ) : null}
        </p>
        <p
          className={cn(
            "type-control truncate font-medium",
            approval.unlimited && !revoked
              ? "text-aomi-warning"
              : "text-aomi-fg",
          )}
          title={title}
        >
          {title}
        </p>
        <p className="type-meta text-aomi-muted truncate">
          {scope} · To {shortAddress(approval.spender, { head: 8, tail: 6 })}
        </p>
      </div>
    </div>
  );
}

function messageHeading({ rows }: MessageReview): string {
  const moves = rows.some(
    (row) => row.kind === "sell" || row.kind === "receive",
  );
  const allows = rows.some((row) => row.kind === "allowance");
  return moves && allows
    ? "Wallet changes"
    : moves
      ? "Balance changes"
      : allows
        ? "Permission changes"
        : "Message";
}

/** The backend's name for a row's token (keys are EIP-55). */
function tokenOf(tokens: MessageReview["tokens"], token: string) {
  return Object.entries(tokens ?? {}).find(
    ([address]) => address.toLowerCase() === token.toLowerCase(),
  )?.[1];
}

/** A token the map names with decimals reads as "500 USDC"; otherwise its
 * raw amount and short address. */
function messageAmount(
  tokens: MessageReview["tokens"],
  token: string,
  amount: string,
): string {
  const known = tokenOf(tokens, token);
  return known?.decimals == null
    ? `${amount} ${assetFallback(token)}`
    : `${formatAssetAmount(amount, known.decimals)} ${known.symbol?.trim() || assetFallback(token)}`;
}

const untilFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Permit2's "never" (2^48 - 1) is past what a JS date can hold. */
function until(seconds: number): string {
  const at = new Date(seconds * 1000);
  return Number.isNaN(at.getTime()) ? "no expiry" : `until ${untilFormat.format(at)}`;
}

/** One row of what a message signature allows, in the trade rows' layout. */
function MessageEffect({
  row,
  tokens,
}: {
  row: MessageReviewRow;
  tokens: MessageReview["tokens"];
}) {
  if (row.kind === "sell" || row.kind === "receive") {
    const incoming = row.kind === "receive";
    const value = messageAmount(tokens, row.token, row.amount);
    return (
      <div
        data-testid="message-effect"
        data-kind={row.kind}
        className="flex min-w-0 items-center gap-3 px-1 py-3"
      >
        <AssetMark
          symbol={tokenOf(tokens, row.token)?.symbol ?? ""}
          incoming={incoming}
        />
        <div className="min-w-0 flex-1">
          <p className="type-meta text-aomi-muted truncate">
            {incoming
              ? row.minimum
                ? "You receive at least"
                : "You receive"
              : "You sell"}
          </p>
        </div>
        <p
          className={cn(
            "type-meta max-w-[60%] truncate whitespace-nowrap text-right font-medium tabular-nums",
            incoming ? "text-aomi-success" : "text-aomi-danger",
          )}
          title={value}
        >
          {incoming ? "+" : "−"}
          {value}
        </p>
      </div>
    );
  }
  const [Icon, eyebrow, title, detail, tone] =
    row.kind === "allowance"
      ? [
          KeyRound,
          "Permission requested",
          row.unlimited
            ? `Unlimited ${tokenOf(tokens, row.token)?.symbol?.trim() || assetFallback(row.token)}`
            : `≤ ${messageAmount(tokens, row.token, row.amount)}`,
          // A symbol is whatever the token contract says; the address isn't.
          `${shortAddress(row.spender, { head: 8, tail: 6 })} may spend token ${shortAddress(row.token)}${
            row.expires_at
              ? ` · ${until(row.expires_at)}`
              : ""
          }`,
          row.unlimited ? "warning" : "accent",
        ]
      : row.kind === "sign_in"
        ? [
            LogIn,
            "Sign-in",
            `Sign in to ${row.domain}`,
            row.statement,
            "accent",
          ]
        : [PenLine, "Message", row.text, undefined, "neutral"];
  return (
    <div
      data-testid="message-effect"
      data-kind={row.kind}
      className="flex min-w-0 items-center gap-3 px-1 py-3"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border",
          tone === "warning"
            ? "border-aomi-warning/20 bg-aomi-warning/10 text-aomi-warning"
            : tone === "accent"
              ? "border-aomi-accent/15 bg-aomi-accent-subtle text-aomi-accent-strong"
              : "border-aomi-border bg-aomi-raised text-aomi-muted",
        )}
      >
        <Icon className="size-3.5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-eyebrow text-aomi-muted">{eyebrow}</p>
        <p
          className={cn(
            "type-control font-medium",
            row.kind === "text" ? "line-clamp-4 break-words" : "truncate",
            tone === "warning" ? "text-aomi-warning" : "text-aomi-fg",
          )}
          title={title}
        >
          {title}
        </p>
        {detail ? (
          <p className="type-meta text-aomi-muted truncate" title={detail}>
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}
