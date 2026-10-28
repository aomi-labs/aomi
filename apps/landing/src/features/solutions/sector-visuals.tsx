import { Check, ChevronRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState } from "react";
import styles from "./sector-pages.module.css";

const mandateViews = {
  liquidity: {
    label: "Preserve liquidity",
    outcome: "Allocate under the treasury mandate",
    reserve: "40%",
    yield: "4.72%",
    allocations: [
      { label: "Operating reserve", value: "40%", width: "40%" },
      { label: "Approved tokenized bills", value: "60%", width: "60%" },
    ],
    rules: ["Issuer allowlist", "40% liquidity floor", "Single-venue cap"],
    trace: [
      { label: "scanning venues", detail: "4 approved issuers · Base" },
      { label: "mandate check", detail: "3 controls · passed" },
      {
        label: "building transaction",
        detail: "approve → subscribe · 1.44M USDC",
      },
      { label: "simulated", detail: "forked live state · ~200 ms" },
    ],
  },
  income: {
    label: "Maximize income",
    outcome: "Route across three approved venues",
    reserve: "30%",
    yield: "5.08%",
    allocations: [
      { label: "Daily liquidity", value: "30%", width: "30%" },
      { label: "Venue A", value: "35%", width: "35%" },
      { label: "Venues B + C", value: "35%", width: "35%" },
    ],
    rules: ["35% venue cap", "Daily liquidity", "Issuer concentration"],
    trace: [
      { label: "scanning venues", detail: "6 markets · 3 chains" },
      { label: "mandate check", detail: "3 controls · passed" },
      {
        label: "building transaction",
        detail: "3 venues · weighted · batched",
      },
      { label: "simulated", detail: "forked live state · ~200 ms" },
    ],
  },
} as const;

export function FintechMandate() {
  const [viewId, setViewId] = useState<keyof typeof mandateViews>("liquidity");
  const view = mandateViews[viewId];

  return (
    <div className={styles.mandateWorkspace}>
      <header className={styles.mandateTopline}>
        <div>
          <span className={styles.liveDot} />
          <strong>Treasury mandate</strong>
        </div>
        <span>$2.4M USDC · Base</span>
      </header>

      <div className={styles.mandateTabs} role="tablist">
        {Object.entries(mandateViews).map(([id, item]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === viewId}
            onClick={() => setViewId(id as keyof typeof mandateViews)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.mandateBody}>
        <div className={styles.mandateAllocation}>
          <span>Proposed allocation</span>
          <h2>{view.outcome}</h2>
          <div className={styles.allocationBars}>
            {view.allocations.map((allocation) => (
              <div key={allocation.label}>
                <div>
                  <span>{allocation.label}</span>
                  <strong>{allocation.value}</strong>
                </div>
                <i>
                  <b style={{ width: allocation.width }} />
                </i>
              </div>
            ))}
          </div>
        </div>

        <aside className={styles.mandatePolicy}>
          <span>Mandate controls</span>
          {view.rules.map((rule) => (
            <div key={rule}>
              <Check aria-hidden />
              <strong>{rule}</strong>
              <small>Passed</small>
            </div>
          ))}
        </aside>
      </div>

      <MandateTrace key={viewId} trace={view.trace} />

      <footer className={styles.mandateFooter}>
        <div>
          <span>Projected yield · illustrative</span>
          <strong>{view.yield}</strong>
        </div>
        <div>
          <span>Liquidity floor</span>
          <strong>{view.reserve}</strong>
        </div>
        <div>
          <span>Approval state</span>
          <strong>Ready for signer</strong>
        </div>
      </footer>
    </div>
  );
}

type TraceStep = { label: string; detail: string };

function MandateTrace({ trace }: { trace: readonly TraceStep[] }) {
  return (
    <ol className={styles.mandateTrace} aria-label="Execution trace">
      {trace.map((step, index) => (
        <li key={step.label} style={{ animationDelay: `${index * 260}ms` }}>
          <Check aria-hidden />
          <span>{step.label}</span>
          <small>{step.detail}</small>
        </li>
      ))}
      <li
        className={styles.mandateTraceSign}
        style={{ animationDelay: `${trace.length * 260}ms` }}
      >
        <LockKeyhole aria-hidden />
        <span>Review &amp; sign</span>
        <small>batched → 1 signature · your wallet</small>
      </li>
    </ol>
  );
}

const collectionItems = [
  {
    id: "8421",
    title: "Afterlight",
    image: "/assets/images/2.jpg",
    price: "0.72 ETH",
    rarity: "4.8%",
    trait: "Prismatic figure",
  },
  {
    id: "1142",
    title: "Office Hours",
    image: "/assets/images/3.jpg",
    price: "0.76 ETH",
    rarity: "6.1%",
    trait: "Archive scene",
  },
  {
    id: "0570",
    title: "Mirror Habitat",
    image: "/assets/images/4.jpg",
    price: "0.79 ETH",
    rarity: "3.7%",
    trait: "Chrome structure",
  },
] as const;

export function NftCollectionConcierge() {
  const [selectedId, setSelectedId] = useState<
    (typeof collectionItems)[number]["id"]
  >(collectionItems[0].id);
  const selected =
    collectionItems.find((item) => item.id === selectedId) ??
    collectionItems[0];

  return (
    <div className={styles.collectionWorkspace}>
      <div className={styles.collectionQuery}>
        <span>Collection concierge</span>
        <p>
          “Show me a verified piece under 0.8 ETH with a rare visual trait.”
        </p>
        <small>3 matches · verified collection</small>
      </div>

      <div className={styles.collectionGrid} role="listbox">
        {collectionItems.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={item.id === selected.id}
            onClick={() => setSelectedId(item.id)}
          >
            <span className={styles.collectionImage}>
              <img
                src={item.image}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
            <span>
              <small>#{item.id}</small>
              <strong>{item.title}</strong>
              <em>{item.price}</em>
            </span>
          </button>
        ))}
      </div>

      <div className={styles.collectionReceipt}>
        <div className={styles.collectionSelected}>
          <span className={styles.collectionThumb}>
            <img src={selected.image} alt="" loading="lazy" decoding="async" />
          </span>
          <div>
            <span>Selected item</span>
            <h3>
              {selected.title} #{selected.id}
            </h3>
            <p>
              {selected.trait} · {selected.rarity} trait rarity
            </p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Listing</dt>
            <dd>{selected.price}</dd>
          </div>
          <div>
            <dt>Royalty</dt>
            <dd>0.018 ETH</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>0.009 ETH</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>0.747 ETH</dd>
          </div>
        </dl>
        <div className={styles.collectionChecks}>
          <span>
            <Check aria-hidden /> Contract verified
          </span>
          <span>
            <Check aria-hidden /> Seller owns item
          </span>
          <span>
            <Check aria-hidden /> Approval scoped
          </span>
        </div>
      </div>
    </div>
  );
}

const walletViews = {
  ask: {
    label: "01 Ask",
    heading: "A clear outcome, in the wallet.",
    body: "Swap 0.5 ETH to USDC, but stop if I receive less than $1,220.",
    state: "Intent understood",
  },
  review: {
    label: "02 Review",
    heading: "Every consequence is visible.",
    body: "0.5 ETH out · minimum 1,220 USDC in · $0.06 network fee · Base",
    state: "Simulation passed",
  },
  sign: {
    label: "03 Sign",
    heading: "The wallet remains the authority.",
    body: "Approve the exact Uniswap v3 action with the wallet’s existing signer.",
    state: "Awaiting your signature",
  },
} as const;

export function WalletJourney() {
  const [viewId, setViewId] = useState<keyof typeof walletViews>("ask");
  const view = walletViews[viewId];

  return (
    <div className={styles.walletStage}>
      <div className={styles.walletTabs} role="tablist">
        {Object.entries(walletViews).map(([id, item]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === viewId}
            onClick={() => setViewId(id as keyof typeof walletViews)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.walletDevice}>
        <header>
          <div>
            <span>A</span>
            <strong>Your wallet</strong>
          </div>
          <small>0xA7…4C</small>
        </header>
        <div className={styles.walletBalance}>
          <span>Portfolio balance</span>
          <strong>$18,420.36</strong>
          <small>Base · Ethereum</small>
        </div>
        <div className={styles.walletAction}>
          <span>{view.label}</span>
          <h2>{view.heading}</h2>
          <p>{view.body}</p>
          <div>
            <ShieldCheck aria-hidden />
            <strong>{view.state}</strong>
            <ChevronRight aria-hidden />
          </div>
        </div>
        <footer>
          <LockKeyhole aria-hidden /> Keys and signing stay in this wallet
        </footer>
      </div>
    </div>
  );
}
