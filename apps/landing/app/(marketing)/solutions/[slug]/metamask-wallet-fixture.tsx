"use client";

import { AomiFrame } from "@aomi-labs/widget/frame";
import { AomiLogo } from "../../../components/aomi-logo";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronLeft,
  Copy,
  ExternalLink,
  MessageCircle,
  MoreHorizontal,
  WalletCards,
} from "lucide-react";
import { useState } from "react";
import styles from "./sector-pages.module.css";

const assets = [
  {
    symbol: "ETH",
    name: "Ethereum",
    amount: "10.00 ETH",
    value: "$31,820.40",
  },
  {
    symbol: "st",
    name: "Lido staked ETH",
    amount: "3.82 stETH",
    value: "$12,153.39",
  },
  {
    symbol: "$",
    name: "USD Coin",
    amount: "2,430.00 USDC",
    value: "$2,430.00",
  },
] as const;

export function MetaMaskWalletFixture() {
  const [screen, setScreen] = useState<"wallet" | "chat">("wallet");

  return (
    <div
      className={styles.metaMaskFixture}
      aria-label="Mywallet assistant demo"
    >
      <div className={styles.metaMaskBrowserBar}>
        <span />
        <span />
        <span />
      </div>

      {screen === "wallet" ? (
        <div className={styles.metaMaskWalletScreen}>
          <header className={styles.metaMaskHeader}>
            <div>
              <WalletCards aria-hidden />
              <strong>Mywallet</strong>
            </div>
            <button type="button" aria-label="More wallet options">
              <MoreHorizontal aria-hidden />
            </button>
          </header>

          <div className={styles.metaMaskNetwork}>
            <i aria-hidden /> Ethereum Mainnet
          </div>

          <section className={styles.metaMaskAccount}>
            <div className={styles.metaMaskAvatar}>A</div>
            <h2>Account 1</h2>
            <button type="button" aria-label="Copy wallet address">
              0x9ecF…D276 <Copy aria-hidden />
            </button>
            <strong>10.00 ETH</strong>
            <span>$31,820.40</span>
          </section>

          <div className={styles.metaMaskActions}>
            <button type="button">
              <span>
                <ArrowDown aria-hidden />
              </span>
              Buy
            </button>
            <button type="button">
              <span>
                <ArrowUpRight aria-hidden />
              </span>
              Send
            </button>
            <button type="button">
              <span>
                <ArrowLeftRight aria-hidden />
              </span>
              Swap
            </button>
            <button
              type="button"
              className={styles.metaMaskChatAction}
              onClick={() => setScreen("chat")}
            >
              <span>
                <MessageCircle aria-hidden />
              </span>
              Chat
            </button>
          </div>

          <div className={styles.metaMaskAssetTabs}>
            <strong>Tokens</strong>
            <span>Activity</span>
          </div>

          <div className={styles.metaMaskAssets}>
            {assets.map((asset) => (
              <div key={asset.name}>
                <span>{asset.symbol}</span>
                <p>
                  <strong>{asset.name}</strong>
                  <small>{asset.value}</small>
                </p>
                <p>
                  <strong>{asset.amount}</strong>
                  <small>{asset.value}</small>
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            className={styles.metaMaskAomiCard}
            onClick={() => setScreen("chat")}
            aria-label="Open Wallet assistant chat"
          >
            <span>
              <AomiLogo
                markClassName={styles.metaMaskAomiLogoMark}
                wordmarkClassName={styles.metaMaskAomiLogoWord}
              />
            </span>
            <p>
              <strong>Wallet assistant is ready</strong>
              <small>Plan a multi-protocol transaction in this wallet.</small>
            </p>
            <MessageCircle aria-hidden />
          </button>
        </div>
      ) : (
        <div className={styles.metaMaskChatScreen}>
          <header className={styles.metaMaskChatHeader}>
            <button
              type="button"
              onClick={() => setScreen("wallet")}
              aria-label="Back to wallet"
            >
              <ChevronLeft aria-hidden />
            </button>
            <div>
              <span>
                <AomiLogo
                  markClassName={styles.metaMaskAomiLogoMark}
                  wordmarkClassName={styles.metaMaskAomiLogoWord}
                />
              </span>
              <p>
                <strong>Chat with wallet</strong>
              </p>
            </div>
            <a
              href="https://chat.aomi.dev"
              target="_blank"
              rel="noreferrer"
              aria-label="Open full Aomi chat"
            >
              <ExternalLink aria-hidden />
            </a>
          </header>

          <div className={styles.metaMaskChatBody}>
            <AomiFrame.Root
              backendUrl="/api/widget-fixture/wallet-compound-borrow"
              applicationId="wallet-compound-borrow-fixture"
              accountSessionAvailable
              initialThreadId="widget-fixture-wallet-compound-borrow"
              persistThread={false}
              showSidebar={false}
              walletPosition={null}
              width="100%"
              height="100%"
              className={styles.metaMaskAomiFrame}
            >
              <AomiFrame.Composer className={styles.metaMaskAomiComposer} />
            </AomiFrame.Root>
          </div>

          <footer className={styles.metaMaskFullChatFooter}>
            <a href="https://chat.aomi.dev" target="_blank" rel="noreferrer">
              Open full chat <ExternalLink aria-hidden />
            </a>
          </footer>
        </div>
      )}
    </div>
  );
}
