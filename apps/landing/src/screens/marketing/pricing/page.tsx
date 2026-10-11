import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MARKETING_ROOT } from "../site";
import { PricingSwitch } from "./pricing-switch";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing | Aomi",
  description:
    "What Aomi costs: pay for the work an agent does, plus an optional fee when it moves value onchain. Flat hosting for businesses.",
  robots: { index: false, follow: false },
};

const example = [
  {
    step: "The ask",
    detail: "“Swap $1,000 of ETH for USDC on Base.”",
    amount: "",
  },
  {
    step: "The agent's work",
    detail: "Reading balances, quoting venues, simulating the batch",
    amount: "$0.40",
  },
  {
    step: "The app's tool fee",
    detail: "A flat price the app set on its order tool",
    amount: "$0.01",
  },
  {
    step: "The app's cut of the swap",
    detail: "0.10% of the $1,000 moved, taken in the token",
    amount: "$1.00",
  },
] as const;

const details = [
  {
    q: "What is a credit?",
    a: "The unit Aomi meters work in. One credit is one cent. A turn's cost is the model tokens it used plus any priced tools it called, converted at published per-model rates.",
  },
  {
    q: "How do I pay?",
    a: "Card or stablecoin. Businesses can also settle over an open payment channel and be billed after the fact rather than before each turn.",
  },
  {
    q: "What happens when I run out?",
    a: "The turn stops and asks you to top up. Nothing is executed, nothing is signed, and you are not charged for the interrupted turn.",
  },
  {
    q: "Who pays the network gas?",
    a: "The wallet that signs, exactly as it would for any transaction. An app can choose to sponsor gas for its users instead.",
  },
  {
    q: "Do outcome fees apply to every transaction?",
    a: "No. They exist only if the app declares one, they are capped by the app's own configuration, and they appear in the confirmation before signing.",
  },
  {
    q: "Is there an enterprise agreement?",
    a: "Yes. Volume hosting, custom revenue share, and dedicated support are handled per contract — talk to us.",
  },
] as const;

export default function PricingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Pricing</p>
          <h1>Pay for what the agent does.</h1>
          <p className={styles.heroCopy}>
            No seats, no subscriptions, no minimums. You pay for the work a turn
            actually performs — and, if an app charges one, a small fee on value
            it moves for you.
          </p>
          <PricingSwitch />
        </div>
      </header>

      <section id="example" className={styles.exampleSection}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.eyebrow}>What it looks like</p>
              <h2>One swap, priced end to end.</h2>
            </div>
            <p>
              A real turn on a $1,000 swap through an app that charges a tool
              fee and takes 10 basis points of the amount moved.
            </p>
          </div>

          <ol className={styles.exampleList}>
            {example.map((row) => (
              <li key={row.step}>
                <strong>{row.step}</strong>
                <span>{row.detail}</span>
                <b>{row.amount}</b>
              </li>
            ))}
          </ol>

          <div className={styles.exampleTotal}>
            <div>
              <span>Total</span>
              <strong>$1.41</strong>
            </div>
            <p>
              $0.41 in credits for the agent&apos;s work, and $1.00 taken inside
              the swap itself. Had the transaction failed, only the work would
              have been charged.
            </p>
          </div>
        </div>
      </section>

      <section id="details" className={styles.detailsSection}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionIntro}>
            <div>
              <p className={styles.eyebrow}>The details</p>
              <h2>FAQ</h2>
            </div>
            <div>
              <p>
                The full schedule — per-model rates, payment rails, and how the
                builder statement is calculated — is in the documentation.
              </p>
              <Link
                to={`${MARKETING_ROOT}/pricing/payment-rails`}
                className={styles.railsLink}
              >
                Explore payment rails <ArrowRight aria-hidden />
              </Link>
            </div>
          </div>

          <dl className={styles.faq}>
            {details.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.sectionInner}>
          <div>
            <p className={styles.eyebrow}>Get started</p>
            <h2>Try it before you pay anything.</h2>
          </div>
          <div className={styles.ctaActions}>
            <a
              href="https://chat.aomi.dev"
              target="_blank"
              rel="noreferrer"
              className={styles.ctaPrimary}
            >
              Open Aomi
              <ArrowUpRight aria-hidden />
            </a>
            <Link
              to={`${MARKETING_ROOT}/contact`}
              className={styles.ctaSecondary}
            >
              Talk to us
              <ArrowRight aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
