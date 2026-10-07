import { CoinsIcon, WalletIcon } from "lucide-react";

/** The same compact account summary in the sidebar chip and its menu. */
export function AccountStatusLine({
  creditsLine,
  connectedWalletCount,
}: {
  creditsLine: string;
  connectedWalletCount: number;
}) {
  const walletLabel = `${connectedWalletCount} ${connectedWalletCount === 1 ? "wallet" : "wallets"}`;
  return (
    <span className="inline-flex max-w-full items-center gap-2 whitespace-nowrap tabular-nums">
      <span
        className="inline-flex items-center gap-1"
        title="Credits remaining"
        aria-label={`${creditsLine} credits remaining`}
      >
        <CoinsIcon size={12} className="shrink-0" aria-hidden="true" />
        <span>{creditsLine}</span>
      </span>
      <span className="px-0.5 font-normal opacity-40" aria-hidden="true">
        /
      </span>
      <span
        className="inline-flex items-center gap-1"
        title={`${walletLabel} connected`}
        aria-label={`${walletLabel} connected`}
      >
        <WalletIcon size={12} className="shrink-0" aria-hidden="true" />
        <span>{connectedWalletCount}</span>
      </span>
    </span>
  );
}
