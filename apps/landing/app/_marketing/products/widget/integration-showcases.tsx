"use client";

import {
  Check,
  ChevronDown,
  CircleDollarSign,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { LandingWalletKitProvider } from "../../../components/landing-wallet-kit-provider";
import { FixtureWidget } from "./fixture-widget";
import { resolveWidgetFixture } from "./fixture-data";
import styles from "./integration-showcases.module.css";

const sommVenues = [
  {
    id: "aave",
    name: "Aave v3",
    asset: "USDC · Base",
    apy: "3.37%",
    avg30: "3.21%",
    tvl: "$24.1M",
    band: "A",
    delta: "+16 bps",
    path: "M0 72 C30 68 44 54 72 58 S118 69 148 47 S196 50 226 34 S278 38 312 21 S344 25 360 14",
    status: "open",
    fixture: "somm-aave",
  },
  {
    id: "sky",
    name: "Sky Lending",
    asset: "USDS · Ethereum",
    apy: "6.12%",
    avg30: "5.88%",
    tvl: "$1.42B",
    band: "A",
    delta: "+24 bps",
    path: "M0 66 C28 57 47 64 76 49 S121 57 151 42 S194 46 226 31 S275 35 309 20 S344 22 360 10",
    status: "post-v1",
    fixture: "somm-sky",
  },
  {
    id: "morpho",
    name: "Morpho",
    asset: "USDe · Base",
    apy: "4.47%",
    avg30: "4.62%",
    tvl: "$86.3M",
    band: "B",
    delta: "−15 bps",
    path: "M0 28 C30 22 49 31 75 26 S120 35 149 34 S196 42 225 45 S274 39 310 53 S343 50 360 63",
    status: "post-v1",
    fixture: "somm-morpho",
  },
  {
    id: "susds",
    name: "Sky Lending",
    asset: "sUSDS · Ethereum",
    apy: "3.52%",
    avg30: "3.50%",
    tvl: "$2.10B",
    band: "A",
    delta: "+2 bps",
    path: "M0 58 C29 55 47 60 75 49 S120 54 149 45 S195 49 224 39 S274 44 309 33 S344 35 360 29",
    status: "post-v1",
    fixture: "somm-susds",
  },
  {
    id: "compound",
    name: "Compound v3",
    asset: "USDC · Ethereum",
    apy: "3.30%",
    avg30: "3.14%",
    tvl: "$412M",
    band: "A",
    delta: "+16 bps",
    path: "M0 69 C30 64 48 69 76 55 S121 61 151 49 S195 54 226 40 S275 46 310 30 S344 32 360 20",
    status: "post-v1",
    fixture: "somm-compound",
  },
  {
    id: "usdt",
    name: "Compound v3",
    asset: "USDT · Ethereum",
    apy: "3.24%",
    avg30: "3.09%",
    tvl: "$198M",
    band: "A",
    delta: "+15 bps",
    path: "M0 70 C29 65 48 69 76 57 S121 62 150 50 S196 55 226 43 S274 47 309 34 S344 36 360 23",
    status: "post-v1",
    fixture: "somm-usdt",
  },
] as const;

const tradeMarkets = {
  eth: {
    symbol: "ETH",
    pair: "ETH / USDC",
    price: "$3,214.72",
    change: "+2.4%",
    dailyChange: "+$74.12 today",
    fixture: "trading-eth",
    path: "M0 176 C38 168 54 139 88 148 S142 177 177 137 S230 104 259 120 S313 94 344 102 S390 61 419 82 S473 64 505 38 S542 44 560 20",
    orderBook: [
      ["3,218.44", "5.82"],
      ["3,216.18", "2.40"],
      ["3,214.72", "8.16"],
      ["3,211.09", "4.07"],
    ],
  },
  btc: {
    symbol: "BTC",
    pair: "BTC / USDC",
    price: "$91,840",
    change: "+1.1%",
    dailyChange: "+$1,004 today",
    fixture: "trading-btc",
    path: "M0 164 C35 151 58 165 88 139 S143 126 177 144 S226 119 259 105 S310 116 344 86 S389 91 419 67 S470 78 505 44 S543 52 560 31",
    orderBook: [
      ["91,912", "0.42"],
      ["91,876", "0.81"],
      ["91,840", "1.16"],
      ["91,794", "0.67"],
    ],
  },
} as const;

const integrationPoints = [
  {
    title: "Build the Aomi app",
    body: "Existing product endpoints are wrapped as a curated set of typed tools, governed by an operating mandate, and deployed to Aomi's hosted runtime. Exposure limits, venue allowlists, and authorization requirements are enforced as execution policy outside the model.",
  },
  {
    title: "Integrate any customer surface",
    body: "The same hosted app is delivered through an embedded Widget, a registered Telegram bot, or Aomi Portal. One application, every channel, with no additional integration work per surface.",
  },
  {
    title: "Retain the existing wallet infrastructure",
    body: "Browser wallets, embedded providers such as Para and Privy, Safe, or an institutional signer remain the authority. Aomi constructs and simulates the exact payload; the designated signer approves it. No private keys are held by Aomi.",
  },
] as const;

export function IntegrationInvariant({ flat = false }: { flat?: boolean }) {
  return (
    <section
      className={`${styles.invariantSection} ${flat ? styles.flatSection : ""}`}
    >
      <div className={styles.shell}>
        <div className={styles.invariantStrip}>
          <div>
            <p className={styles.eyebrow}>INTEGRATION MODEL</p>
            <h3>
              One application across every surface, under customized API
              contracts
            </h3>
          </div>
          <div className={styles.invariantPoints}>
            {integrationPoints.map((point, index) => (
              <div key={point.title}>
                <span>0{index + 1}</span>
                <div>
                  <h4>{point.title}</h4>
                  <p>{point.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function IntegrationShowcases({
  flat = false,
  afterTrading = null,
  segment = "all",
}: {
  flat?: boolean;
  afterTrading?: ReactNode;
  segment?: "all" | "sommelier" | "remaining";
}) {
  return (
    <section
      className={`${styles.section} ${flat ? styles.flatSection : ""} ${segment === "sommelier" ? styles.sommelierSegment : ""}`}
    >
      <div className={styles.shell}>
        {!flat && segment === "all" ? (
          <div className={styles.intro}>
            <div>
              <p className={styles.eyebrow}>ONE SURFACE, DIFFERENT PRODUCTS</p>
              <h2>Built into the product. Not bolted onto it.</h2>
            </div>
            <p className={styles.introBody}>
              Use Aomi as a complete assistant, a trading sidecar, or an inline
              transaction composer. The host experience changes. The execution
              boundary does not.
            </p>
          </div>
        ) : null}

        <LandingWalletKitProvider>
          {segment !== "remaining" ? (
            <article
              id="somm"
              className={`${styles.caseStudy} ${styles.sommCase}`}
            >
              <CaseCopy
                number="01"
                label="Shipped · agentic.somm.finance"
                live
                eyebrow="Managed assets"
                title="Make the mandate visible."
                body="Sommelier turns its existing strategy endpoints and risk mandate into an operator- and depositor-facing execution product. The agent proposes each move; the manager retains approval and custody."
                points={[
                  "Strategy endpoints wrapped as agent tools",
                  "Risk bands and venue limits enforced every turn",
                  "One branded surface for operators and depositors",
                ]}
              />
              <SommDemo showCaption={!flat} showMarketData={flat} />
            </article>
          ) : null}

          {segment !== "sommelier" ? (
            <>
              <article
                id="trading"
                className={`${styles.caseStudy} ${styles.tradingCase}`}
              >
                <TradingDemo />
                <CaseCopy
                  number="02"
                  label="Integration concept"
                  eyebrow="Trading · Telegram"
                  title="The same desk, from a Telegram chat."
                  body="Register a bot token, attach the desk's plugin, and traders message it like a colleague. Aomi quotes the venues you expose, simulates the split route, checks your slippage and notional policy, and returns the order for the trader's own wallet—no custody, no new app."
                  points={[
                    "Each trader chats on their own Aomi identity and wallet",
                    "Route, slippage, and notional policy checked before signing",
                    "Autonomous signing is off until the trader turns it on with /permission",
                  ]}
                />
              </article>

              {afterTrading}

              <article
                id="prediction-markets"
                className={`${styles.caseStudy} ${styles.predictionCase}`}
              >
                <CaseCopy
                  number="03"
                  label="Integration concept"
                  eyebrow="Prediction markets"
                  title="Turn research into a bounded position."
                  body="Place an inline assistant directly on a market page. The Widget can explain the resolution criteria, read liquidity, enforce a price and loss cap, and stage the exact position without taking the user out of context."
                  points={[
                    "Market context and portfolio state already in scope",
                    "Price, exposure, and maximum-loss limits made explicit",
                    "The selected outcome drives a deterministic position preview",
                  ]}
                />
                <PredictionDemo />
              </article>
            </>
          ) : null}
        </LandingWalletKitProvider>
      </div>
    </section>
  );
}

interface CaseCopyProps {
  number: string;
  label: string;
  live?: boolean;
  eyebrow: string;
  title: string;
  body: string;
  points: readonly string[];
}

function CaseCopy({
  number,
  label,
  live = false,
  eyebrow,
  title,
  body,
  points,
}: CaseCopyProps) {
  return (
    <div className={styles.caseCopy}>
      <div className={styles.caseMeta}>
        <span>{number}</span>
        <span className={live ? styles.liveLabel : styles.conceptLabel}>
          {live ? <i aria-hidden /> : null}
          {label}
        </span>
      </div>
      <p className={styles.caseEyebrow}>{eyebrow}</p>
      <h3>{title}</h3>
      <p className={styles.caseBody}>{body}</p>
      <ul className={styles.casePoints}>
        {points.map((point) => (
          <li key={point}>
            <Check aria-hidden className="size-3.5" strokeWidth={2.2} />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SommDemo({
  showCaption = true,
  showMarketData = false,
}: {
  showCaption?: boolean;
  showMarketData?: boolean;
}) {
  const [selectedVenue, setSelectedVenue] = useState<
    (typeof sommVenues)[number]
  >(sommVenues[0]);

  return (
    <figure
      className={styles.sommDemo}
      aria-label="Sommelier Widget integration"
    >
      <div className={styles.sommTopline}>
        <span>SHIPPED</span>
        <span>AGENTIC.SOMM.FINANCE</span>
      </div>
      <div className={styles.sommFrame}>
        <div className={styles.sommHeader}>
          <div className={styles.sommBrand}>
            <span className={styles.sommLogo} aria-hidden />
            <div>
              <strong>Sommelier</strong>
              <span>Idle USDC, working on Base · powered by aomi</span>
            </div>
          </div>
          <span className={styles.walletPill}>
            <i aria-hidden /> 0xa73…F5
          </span>
        </div>

        <div className={styles.venuePanel}>
          <div className={styles.venueHeader}>
            <span>VENUES · NET YIELD</span>
            <span>1 OPEN · 5 TRACKED</span>
          </div>
          {showMarketData ? (
            <section
              className={styles.sommMarket}
              aria-label="Deterministic market context"
            >
              <header>
                <span>MARKET CONTEXT</span>
                <small>FIXTURE · CYCLE 08:42 UTC</small>
              </header>
              <div className={styles.sommBalances}>
                <div>
                  <span>Idle USDC</span>
                  <strong>$2.40M</strong>
                  <small>62% of treasury</small>
                </div>
                <div>
                  <span>Deployable</span>
                  <strong>$1.56M</strong>
                  <small>35% reserve retained</small>
                </div>
              </div>
              <div className={styles.sommYieldChart}>
                <div>
                  <div>
                    <span>{selectedVenue.name}</span>
                    <small>{selectedVenue.asset}</small>
                  </div>
                  <strong>{selectedVenue.apy}</strong>
                </div>
                <svg
                  viewBox="0 0 360 90"
                  role="img"
                  aria-label={`${selectedVenue.name} net APY trend fixture`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient
                      id="somm-yield-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0" stopColor="#38d89f" stopOpacity="0.2" />
                      <stop offset="1" stopColor="#38d89f" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    className={styles.sommYieldArea}
                    d={`${selectedVenue.path} L360 90 L0 90 Z`}
                  />
                  <path
                    className={styles.sommYieldLine}
                    d={selectedVenue.path}
                  />
                </svg>
              </div>
              <dl className={styles.sommMarketMetrics}>
                <div>
                  <dt>30d avg</dt>
                  <dd>{selectedVenue.avg30}</dd>
                </div>
                <div>
                  <dt>vs 30d</dt>
                  <dd>{selectedVenue.delta}</dd>
                </div>
                <div>
                  <dt>TVL</dt>
                  <dd>{selectedVenue.tvl}</dd>
                </div>
                <div>
                  <dt>Mandate</dt>
                  <dd>Band {selectedVenue.band}</dd>
                </div>
              </dl>
            </section>
          ) : null}
          <div className={styles.venueGrid} role="tablist">
            {sommVenues.map((venue) => {
              const selected = venue.id === selectedVenue.id;
              return (
                <button
                  type="button"
                  key={venue.id}
                  role="tab"
                  className={`${styles.venueCard} ${selected ? styles.venueSelected : ""} ${venue.status === "open" ? styles.venueOpen : ""}`}
                  onClick={() => setSelectedVenue(venue)}
                  aria-selected={selected}
                >
                  <div>
                    <i aria-hidden />
                    <strong>{venue.name}</strong>
                    <em>{venue.status}</em>
                  </div>
                  <span>{venue.asset}</span>
                  <p>
                    {venue.apy} <small>net apy</small>
                  </p>
                  <dl>
                    <dt>30d avg</dt>
                    <dd>{venue.avg30}</dd>
                    <dt>tvl</dt>
                    <dd>{venue.tvl}</dd>
                    <dt>risk band</dt>
                    <dd>{venue.band}</dd>
                  </dl>
                </button>
              );
            })}
          </div>
          <p className={styles.venueNote}>
            rates refreshed each cycle · only band A with deposits open is
            eligible today
          </p>
        </div>

        <div className={styles.sommFloat}>
          <FixtureWidget
            scenario="somm"
            fixture={selectedVenue.fixture}
            label={`${selectedVenue.name} mandate`}
          />
        </div>
      </div>
      {showCaption ? (
        <figcaption>
          Full-surface embed · application tools + mandate + existing signer
        </figcaption>
      ) : null}
    </figure>
  );
}

function TradingDemo() {
  const [selectedMarket, setSelectedMarket] =
    useState<keyof typeof tradeMarkets>("eth");
  const market = tradeMarkets[selectedMarket];

  return (
    <figure
      className={styles.tradingDemo}
      aria-label="Trading Widget integration concept"
    >
      <div className={styles.tradeHeader}>
        <div className={styles.tradeBrand}>
          <TrendingUp aria-hidden className="size-4" />
          <strong>VERTEX DESK</strong>
        </div>
        <span className={styles.tradeWallet}>
          <Wallet className="size-3.5" /> 0x91…0B
        </span>
      </div>

      <div className={styles.tradeWorkspace}>
        <div className={styles.marketPanel}>
          <div className={styles.marketTitle}>
            <div>
              <strong>{market.pair}</strong>
              <span>aggregated spot</span>
            </div>
            <span>
              1H <ChevronDown className="size-3" />
            </span>
          </div>
          <div className={styles.chart}>
            <div className={styles.chartPrice}>
              <strong>{market.price}</strong>
              <span>{market.dailyChange}</span>
            </div>
            <svg viewBox="0 0 560 210" preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="tradeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#35e6a4" stopOpacity=".25" />
                  <stop offset="1" stopColor="#35e6a4" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d={`${market.path} L560 210 L0 210 Z`}
                fill="url(#tradeArea)"
              />
              <path
                d={market.path}
                fill="none"
                stroke="#35e6a4"
                strokeWidth="3"
              />
            </svg>
          </div>
          <div className={styles.orderBook}>
            <div>
              <span>PRICE</span>
              <span>SIZE {market.symbol}</span>
            </div>
            {market.orderBook.map(([price, size], index) => (
              <div key={price}>
                <span className={index < 2 ? styles.ask : styles.bid}>
                  {price}
                </span>
                <span>{size}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.tradeFloat}>
          <TelegramChat fixture={market.fixture} symbol={market.symbol} />
        </div>
      </div>

      <div className={styles.tradeMarketBar}>
        <span>SELECT MARKET</span>
        <div className={styles.tickers}>
          {Object.entries(tradeMarkets).map(([id, item]) => (
            <button
              type="button"
              key={id}
              className={id === selectedMarket ? styles.tickerSelected : ""}
              onClick={() => setSelectedMarket(id as keyof typeof tradeMarkets)}
              aria-pressed={id === selectedMarket}
            >
              {item.symbol} <b>{item.price}</b> <i>{item.change}</i>
            </button>
          ))}
        </div>
      </div>
      <figcaption>
        Telegram bot · desk plugin + route policy + trader&apos;s own wallet
      </figcaption>
    </figure>
  );
}

function renderBold(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("**") ? (
        <b key={index}>{part.slice(2, -2)}</b>
      ) : (
        <span key={index}>{part}</span>
      ),
    );
}

function TelegramChat({
  fixture,
  symbol,
}: {
  fixture: string;
  symbol: string;
}) {
  const [, data] = resolveWidgetFixture(fixture);

  return (
    <div
      className={styles.tgDevice}
      aria-label={`Telegram bot ${symbol} route preview`}
    >
      <div className={styles.tgTopbar}>
        <span className={styles.tgIconButton} aria-hidden>
          ‹
        </span>
        <span className={styles.tgAvatar} aria-hidden>
          <TrendingUp className="size-4" />
        </span>
        <div className={styles.tgTitle}>
          <b>Vertex Desk Agent</b>
          <span>bot</span>
        </div>
        <span className={styles.tgIconButton} aria-hidden>
          ⌕
        </span>
        <span className={styles.tgIconButton} aria-hidden>
          ⋮
        </span>
      </div>
      <div className={styles.tgWallpaper}>
        <div className={styles.tgDate}>Today</div>
        <div className={`${styles.tgMessage} ${styles.tgOut}`}>
          {data.prompt}
          <span className={styles.tgTime}>
            10:42 <i>✓✓</i>
          </span>
        </div>
        <div className={styles.tgInRow}>
          <span className={styles.tgAvatar} aria-hidden>
            <TrendingUp className="size-3" />
          </span>
          <div className={styles.tgBotStack}>
            <div className={`${styles.tgMessage} ${styles.tgIn}`}>
              <b className={styles.tgLead}>{data.title} prepared.</b>
              {renderBold(data.answer)} Your policy checks will apply before
              signing.
              <span className={styles.tgTime}>10:42</span>
            </div>
            <div className={styles.tgKeyboard}>Review order · {data.title}</div>
            <div className={styles.tgKeyboard}>Approve &amp; sign&nbsp;↗</div>
            <div className={`${styles.tgKeyboard} ${styles.tgKeyboardMuted}`}>
              /permission · manual <em>· agent cannot sign alone</em>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.tgComposer}>
        <span className={styles.tgMenu}>☰&nbsp; Menu</span>
        <span className={styles.tgInput}>Message</span>
        <span className={styles.tgMic} aria-hidden>
          ●
        </span>
      </div>
    </div>
  );
}

function PredictionDemo() {
  const [selectedOutcome, setSelectedOutcome] = useState<"yes" | "no">("yes");
  const isYes = selectedOutcome === "yes";

  return (
    <figure
      className={styles.predictionDemo}
      aria-label="Prediction-market Widget integration concept"
    >
      <div className={styles.predictionHeader}>
        <div className={styles.forecastBrand}>
          <CircleDollarSign aria-hidden className="size-5" />
          <strong>FORECAST</strong>
        </div>
        <div className={styles.predictionNav}>
          <span>Markets</span>
          <span>Portfolio</span>
          <span>Activity</span>
        </div>
        <span className={styles.forecastWallet}>$2,840 · 0x2A…19</span>
      </div>

      <div className={styles.predictionBody}>
        <div className={styles.marketContext}>
          <span className={styles.marketCategory}>CRYPTO · DEC 31</span>
          <h4>Will ETH close above $5,000 by year end?</h4>
          <div className={styles.probabilityRow}>
            <div>
              <strong className={isYes ? "" : styles.probabilityNo}>
                {isYes ? "58%" : "42%"}
              </strong>
              <span>{selectedOutcome} probability</span>
            </div>
            <svg viewBox="0 0 340 92" preserveAspectRatio="none" aria-hidden>
              <path
                d="M0 70 C31 67 52 79 77 58 S126 61 149 46 S190 52 214 34 S263 43 287 22 S322 28 340 12"
                fill="none"
                stroke={isYes ? "#2857f0" : "#d74367"}
                strokeWidth="3"
              />
            </svg>
          </div>
          <div className={styles.outcomeButtons}>
            <button
              type="button"
              className={isYes ? styles.outcomeSelected : ""}
              onClick={() => setSelectedOutcome("yes")}
              aria-pressed={isYes}
            >
              YES <b>58¢</b>
            </button>
            <button
              type="button"
              className={!isYes ? styles.outcomeSelected : ""}
              onClick={() => setSelectedOutcome("no")}
              aria-pressed={!isYes}
            >
              NO <b>44¢</b>
            </button>
          </div>
          <div className={styles.marketStats}>
            <span>
              <small>VOLUME</small>
              <b>$8.4M</b>
            </span>
            <span>
              <small>LIQUIDITY</small>
              <b>$740K</b>
            </span>
            <span>
              <small>RESOLVES</small>
              <b>Dec 31</b>
            </span>
          </div>
        </div>

        <div className={styles.inlineComposer}>
          <FixtureWidget
            scenario="prediction"
            fixture={`prediction-${selectedOutcome}`}
            label={`${selectedOutcome.toUpperCase()} position preview`}
          />
        </div>
      </div>
      <figcaption>
        Inline embed · market context + exposure policy + position preview
      </figcaption>
    </figure>
  );
}
