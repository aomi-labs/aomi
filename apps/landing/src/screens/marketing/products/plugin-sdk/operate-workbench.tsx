"use client";

import {
  Activity,
  Gauge,
  ListFilter,
  Lock,
  ScrollText,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./plugin-sdk-marketing.module.css";

type OperateTab = "observability" | "transactions" | "usage" | "logs";

const tabs = [
  { id: "observability", label: "Observability", icon: Activity },
  { id: "transactions", label: "Transactions", icon: WalletCards },
  { id: "usage", label: "Usage", icon: Gauge },
  { id: "logs", label: "Logs", icon: ScrollText },
] as const;

const apps = [
  [
    "sommelier-liquidity-manager",
    "release-2026.08.24-liquidity",
    "38",
    "96",
    "14",
    "0.0%",
    "1.0%",
    "0.0%",
    "1,180 ms",
    "SDK 3.0.3 · 3 priced tools · cold start 720 ms · 2.1 MB",
  ],
  [
    "polymarket-trader",
    "release-2026.08.23-markets",
    "84",
    "214",
    "31",
    "1.2%",
    "2.3%",
    "3.2%",
    "1,960 ms",
    "SDK 3.0.3 · 3 tools · cold start 860 ms · 1.9 MB",
  ],
  [
    "hyperliquid-arb-bot",
    "release-2026.08.24-funding-arb",
    "22",
    "482",
    "67",
    "0.0%",
    "1.5%",
    "1.5%",
    "780 ms",
    "SDK 3.0.3 · 4 tools · cold start 640 ms · 2.3 MB",
  ],
  [
    "world-market-telegram",
    "release-2026.08.22-telegram",
    "126",
    "301",
    "46",
    "0.0%",
    "2.0%",
    "2.2%",
    "1,420 ms",
    "SDK 3.0.3 · 3 tools · cold start 910 ms · 2.0 MB",
  ],
] as const;

const toolNames = [
  "get_idle_assets",
  "rebalance_liquidity",
  "read_market",
  "quote_order",
  "scan_funding_spread",
  "open_hedged_position",
  "quote_world_market",
  "place_world_order",
] as const;

const transactions = [
  [
    "Jul 27, 10:37 AM",
    "sommelier-liquidity-manager",
    "confirmed",
    "Base Sepolia",
    "0x5D90…4c9B",
    "$250,000",
    "Supply idle USDC to Aave v3 on Base",
    "0x55e5…df74",
  ],
  [
    "Jul 15, 11:07 PM",
    "polymarket-trader",
    "confirmed",
    "Polygon",
    "0x4D97…6045",
    "$500.00",
    "Buy 806 YES shares · ETH above $5K",
    "0x7bd8…51c2",
  ],
  [
    "Jul 15, 10:42 PM",
    "hyperliquid-arb-bot",
    "confirmed",
    "Hyperliquid",
    "0x2000…00ab",
    "$125,000",
    "Open delta-neutral ETH funding arbitrage",
    "0x88e2…d2e9",
  ],
  [
    "Jul 15, 9:54 PM",
    "world-market-telegram",
    "submitted",
    "MegaETH",
    "0x91f2…c08B",
    "$64,294",
    "Route 20 ETH order from Telegram",
    "0x2vJq…Mzp9",
  ],
  [
    "Jul 15, 8:08 PM",
    "hyperliquid-arb-bot",
    "failed",
    "Hyperliquid",
    "0x2000…00ab",
    "$85,000",
    "Open BTC funding arbitrage · spread below floor",
    "—",
  ],
] as const;

const logs = [
  [
    "23:07",
    "scan_funding_spread",
    "420ms",
    "ETH funding +12.4% annualized · hedge route eligible",
    "hyperliquid-arb-bot",
    "ok",
  ],
  [
    "23:05",
    "place_world_order",
    "",
    "20 ETH routed across two venues · max slippage 20 bps",
    "world-market-telegram",
    "ok",
  ],
  [
    "22:08",
    "quote_order",
    "1,240ms",
    "LimitPriceExceeded: YES 64¢ > configured 62¢",
    "polymarket-trader",
    "error",
  ],
  [
    "21:13",
    "rebalance_liquidity",
    "2,180ms",
    "Aave v3 selected · 3.37% net APY · risk band A",
    "sommelier-liquidity-manager",
    "ok",
  ],
  [
    "20:50",
    "open_hedged_position",
    "790ms",
    "PolicyDenied: projected notional exceeds $100k mandate",
    "hyperliquid-arb-bot",
    "error",
  ],
  [
    "19:30",
    "deployment",
    "",
    "Activated release …2026.08.23-markets",
    "polymarket-trader",
    "ok",
  ],
] as const;

const revenue = [
  [
    "Tool invocations",
    "hyperliquid-arb-bot",
    "482",
    "$482.00",
    "$48.20",
    "$433.80",
  ],
  ["Outcome fees", "polymarket-trader", "31", "$155.00", "$46.50", "$108.50"],
  [
    "Tool invocations",
    "world-market-telegram",
    "301",
    "$150.50",
    "$15.05",
    "$135.45",
  ],
  [
    "Tool invocations",
    "sommelier-liquidity-manager",
    "96",
    "$96.00",
    "$9.60",
    "$86.40",
  ],
] as const;

const charges = [
  ["Model usage", "hyperliquid-arb-bot", "482", "$18.42"],
  ["App hosting", "hyperliquid-arb-bot", "1", "$10.00"],
  ["Model usage", "polymarket-trader", "214", "$8.61"],
  ["App hosting", "world-market-telegram", "1", "$10.00"],
  ["App hosting", "sommelier-liquidity-manager", "1", "$10.00"],
] as const;

function PanelHeader({ tab }: { tab: OperateTab }) {
  const meta = tabs.find((item) => item.id === tab) ?? tabs[2];
  const Icon = meta.icon;
  return (
    <header className={styles.operateViewHeader}>
      <div>
        <Icon aria-hidden />
        <h3>{meta.label}</h3>
      </div>
      <label>
        <ListFilter aria-hidden />
        <select aria-label="Project filter" defaultValue="all">
          <option value="all">All projects</option>
          {apps.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

function MetricGrid({
  items,
}: {
  items: readonly (readonly [string, string, string, boolean?])[];
}) {
  return (
    <div className={styles.operateMetricGrid}>
      {items.map(([label, value, note, positive]) => (
        <div key={label}>
          <span>{label}</span>
          <strong className={positive ? styles.operatePositive : undefined}>
            {value}
          </strong>
          <small>{note}</small>
        </div>
      ))}
    </div>
  );
}

function DataCard({
  title,
  right,
  columns,
  rows,
  className,
}: {
  title: string;
  right?: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  className?: string;
}) {
  return (
    <section className={`${styles.operateDataCard} ${className ?? ""}`}>
      <header>
        <span>{title}</span>
        {right ? <small>{right}</small> : null}
      </header>
      <div className={styles.operateDataScroll}>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${title}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ObservabilityView() {
  return (
    <div className={styles.operateStack}>
      <div className={styles.operateMonitorBar}>
        <div>
          <span>Monitoring</span> <strong>ok</strong>
          <small> · 15m window</small>
        </div>
        <button type="button">Open dashboard</button>
      </div>
      <section className={styles.operateDataCard}>
        <header>
          <div>
            <span>Payment health</span>
            <small>
              24h activity · outstanding is the live recipient-bucket balance
            </small>
          </div>
        </header>
        <div className={styles.operateCardMetrics}>
          <MetricGrid
            items={[
              ["Priced calls", "14", ""],
              ["Accrued", "$17.50", ""],
              ["Settled", "$15.00", ""],
              ["Outstanding", "$2.50", "", true],
            ]}
          />
        </div>
      </section>
      <div className={styles.operateHealthGrid}>
        {apps.map(
          ([
            name,
            release,
            chats,
            tools,
            tx,
            chatErrors,
            toolErrors,
            txFailures,
            latency,
            lifecycle,
          ]) => (
            <article key={name} className={styles.operateHealthCard}>
              <header>
                <div>
                  <strong>{name}</strong>
                  <small>{release}</small>
                </div>
                <em>
                  <i />
                  healthy
                </em>
              </header>
              <div className={styles.operateHealthNumbers}>
                <div>
                  <span>Chats 24h</span>
                  <strong>{chats}</strong>
                </div>
                <div>
                  <span>Tool calls 24h</span>
                  <strong>{tools}</strong>
                </div>
                <div>
                  <span>Tx 24h</span>
                  <strong>{tx}</strong>
                </div>
              </div>
              <div className={styles.operateHealthDetails}>
                <div>
                  <span>Chat errors</span>
                  <strong>{chatErrors}</strong>
                </div>
                <div>
                  <span>Tool errors</span>
                  <strong>{toolErrors}</strong>
                </div>
                <div>
                  <span>Tx failures</span>
                  <strong>{txFailures}</strong>
                </div>
                <div>
                  <span>P95 latency</span>
                  <strong>{latency}</strong>
                </div>
              </div>
              <footer>{lifecycle}</footer>
            </article>
          ),
        )}
      </div>
    </div>
  );
}

function TransactionsView() {
  const [appFilter, setAppFilter] = useState("all");
  const visible = useMemo(
    () =>
      transactions.filter(
        (transaction) => appFilter === "all" || transaction[1] === appFilter,
      ),
    [appFilter],
  );
  return (
    <div className={styles.operateStack}>
      <div className={styles.operateFilterBar}>
        <select
          value={appFilter}
          onChange={(event) => setAppFilter(event.target.value)}
          aria-label="Application filter"
        >
          <option value="all">All apps</option>
          {apps.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span>{visible.length} records</span>
      </div>
      <DataCard
        title="Transactions"
        columns={[
          "Time",
          "App",
          "Status",
          "Chain",
          "To",
          "Value",
          "Description",
          "Hash",
        ]}
        rows={visible}
        className={styles.operateWideTable}
      />
    </div>
  );
}

function UsageView() {
  return (
    <div className={styles.operateStack}>
      <p className={styles.operateIntro}>
        Revenue, platform fees, and charges for your apps in this statement
        period. End-user spend is reported separately under{" "}
        <strong>Account → Billing</strong>.
      </p>
      <MetricGrid
        items={[
          ["Gross revenue", "$883.50", "collected from end users"],
          ["Platform fees", "−$119.35", "revenue share"],
          ["Service charges", "−$57.03", "model usage & hosting"],
          ["Net", "+$707.12", "Jul 1 – Jul 15", true],
        ]}
      />
      <div className={styles.operateSubhead}>
        <div>
          <strong>Partner payments</strong>
          <p>
            Partner payments are liabilities owed to tool beneficiaries, not
            builder revenue. Settlements are reconciled at recipient-bucket
            scope because one receipt can clear fees from more than one app.
            Accrued and settled cover this statement; current outstanding is the
            live balance across all periods.
          </p>
        </div>
        <span>Statement · Jul 1 – Jul 15</span>
      </div>
      <MetricGrid
        items={[
          ["Priced calls", "14", "1 configured tool"],
          ["Accrued", "$17.50", "1,750 credits · statement period"],
          ["Settled", "$15.00", "1 receipt · statement period"],
          [
            "Current outstanding",
            "$2.50",
            "all periods · recipient bucket",
            true,
          ],
        ]}
      />
      <div className={styles.operateDataPair}>
        <DataCard
          title="Configured prices"
          columns={["Tool", "Price", "Beneficiary", "Observed"]}
          rows={[
            [
              "rebalance_liquidity · sommelier-liquidity-manager",
              "125.00 credits · $1.25 / success",
              "0x5D90…4c9B · Base Sepolia",
              "14 calls",
            ],
          ]}
        />
        <DataCard
          title="Payment activity"
          columns={["Time", "Event", "Amount", "Receipt"]}
          rows={[
            [
              "7/27/2026, 10:37 AM",
              "Settlement confirmed · sommelier-liquidity-manager",
              "$15.00 · 1,500 credits",
              "0x55e5…df74 ↗",
            ],
            [
              "7/27/2026, 9:59 AM",
              "Fee accrued · sommelier-liquidity-manager",
              "$2.50 · 250 credits",
              "—",
            ],
          ]}
        />
      </div>
      <DataCard
        title="Revenue"
        right="Jul 1 – Jul 15"
        columns={["Subject", "App", "Events", "Gross", "Platform fee", "Net"]}
        rows={revenue}
      />
      <div className={styles.operateChargesGrid}>
        <DataCard
          title="Charges"
          columns={["Item", "App", "Events", "Amount"]}
          rows={charges}
        />
        <section className={styles.operateDataCard}>
          <header>
            <span>Model usage detail</span>
            <small>by provider/model</small>
          </header>
          <div className={styles.operateModelDetail}>
            <p>
              <code>anthropic/claude-sonnet-4-6</code>
              <span>31.8240</span>
            </p>
            <p>
              <code>openai/gpt-5.2-mini</code>
              <span>12.4060</span>
            </p>
            <small>
              Token-level usage explains the base cost. Apps using
              customer-provided keys (BYOK) incur no model charges.
            </small>
          </div>
        </section>
      </div>
    </div>
  );
}

function LogsView() {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [appFilter, setAppFilter] = useState("all");
  const [toolFilter, setToolFilter] = useState("all");
  const visible = logs.filter(
    (log) =>
      (!errorsOnly || log[5] === "error") &&
      (appFilter === "all" || log[4] === appFilter) &&
      (toolFilter === "all" || log[1] === toolFilter),
  );
  return (
    <div className={styles.operateStack}>
      <div className={styles.operateFilterBar}>
        <select
          aria-label="Application filter"
          value={appFilter}
          onChange={(event) => setAppFilter(event.target.value)}
        >
          <option value="all">All apps</option>
          {apps.map(([name]) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Tool filter"
          value={toolFilter}
          onChange={(event) => setToolFilter(event.target.value)}
        >
          <option value="all">All tools</option>
          {toolNames.map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={errorsOnly ? styles.operateFilterActive : undefined}
          onClick={() => setErrorsOnly((current) => !current)}
        >
          Errors only
        </button>
        <button type="button">Partner payments only</button>
        <span>
          <Lock aria-hidden /> user messages and intents are never shown
        </span>
      </div>
      <div className={styles.operateLogStream}>
        <header>Jul 15, 2026</header>
        {visible.map(([time, event, duration, summary, app, status]) => (
          <div
            key={`${time}-${event}`}
            className={status === "error" ? styles.operateLogError : undefined}
          >
            <i />
            <time>{time}</time>
            <strong>{event}</strong>
            <small>{duration}</small>
            <p>{summary}</p>
            <span>{app}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OperateWorkbench() {
  const [activeTab, setActiveTab] = useState<OperateTab>("usage");
  return (
    <div className={styles.operateWorkbench}>
      <div
        className={styles.operateTabs}
        role="tablist"
        aria-label="Operate views"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`operate-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="operate-panel"
              className={selected ? styles.operateTabActive : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        id="operate-panel"
        role="tabpanel"
        aria-labelledby={`operate-tab-${activeTab}`}
        className={styles.operateView}
      >
        <PanelHeader tab={activeTab} />
        {activeTab === "observability" && <ObservabilityView />}
        {activeTab === "transactions" && <TransactionsView />}
        {activeTab === "usage" && <UsageView />}
        {activeTab === "logs" && <LogsView />}
      </div>
    </div>
  );
}
