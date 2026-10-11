import {
  ArrowRight,
  BadgeCheck,
  Check,
  Fingerprint,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { SolutionConfig } from "../../../marketing-templates/solutions/solution-data";
import { MARKETING_ROOT } from "../../site";
import { NftCollectionConcierge } from "./sector-visuals";
import styles from "./sector-pages.module.css";

const motivations = [
  ["Aesthetic", "Find work by visual language, not contract address."],
  ["Utility", "Surface access, membership, and collection benefits."],
  ["Community", "Explain provenance and the context around ownership."],
  ["Value", "Compare listing, rarity, total cost, and live market state."],
] as const;

const trustChecks = [
  {
    icon: BadgeCheck,
    label: "Identity",
    title: "The collection is the collection.",
    body: "Contract identity, collection verification, and metadata integrity are checked before an item is recommended.",
  },
  {
    icon: Fingerprint,
    label: "Ownership",
    title: "The seller still owns the exact item.",
    body: "Live ownership, listing state, operator scope, and marketplace authority are evaluated at review time.",
  },
  {
    icon: ReceiptText,
    label: "Checkout",
    title: "The displayed price is the complete price.",
    body: "Listing, marketplace fee, royalty, gas, network, and exact token appear in one confirmation.",
  },
] as const;

export function NftPage({ solution }: { solution: SolutionConfig }) {
  return (
    <main className={styles.nftPage}>
      <section className={`${styles.sectorHero} ${styles.nftHero}`}>
        <div className={styles.nftHeroCopy}>
          <p className={styles.eyebrow}>{solution.eyebrow}</p>
          <h1>{solution.headline}</h1>
          <p className={styles.sectorLede}>{solution.lede}</p>
          <div className={styles.heroActions}>
            <a href="#collection-concierge">
              Try the concierge <ArrowRight aria-hidden />
            </a>
            <Link to={`${MARKETING_ROOT}/contact`}>
              Design a collection flow
            </Link>
          </div>
        </div>
        <div className={styles.nftHeroStatement}>
          <Sparkles aria-hidden />
          <p>Discovery should feel editorial.</p>
          <strong>Checkout should feel exact.</strong>
          <span>{solution.audience}</span>
        </div>
      </section>

      <section id="collection-concierge" className={styles.conciergeSection}>
        <header className={styles.splitHeading}>
          <div>
            <p className={styles.eyebrow}>Collection experience concept</p>
            <h2>From taste to one verified item.</h2>
          </div>
          <p>
            The agent narrows the collection. The checkout preserves the exact
            token, seller, cost, and approval that the collector will sign.
          </p>
        </header>
        <NftCollectionConcierge />
        <p className={styles.artifactCaption}>
          Deterministic marketplace concept · artwork from the existing Aomi
          design library
        </p>
      </section>

      <section className={styles.collectorMotivations}>
        <header>
          <p className={styles.eyebrow}>Meet the motivation</p>
          <h2>Collecting rarely starts with a transaction.</h2>
        </header>
        <div>
          {motivations.map(([title, body], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.nftTrust}>
        <header className={styles.nftTrustHeading}>
          <p className={styles.eyebrow}>Trust before urgency</p>
          <h2>Every recommendation carries its own dossier.</h2>
          <p>Confidence comes from visible evidence—not a louder buy button.</p>
        </header>
        <div className={styles.trustStack}>
          {trustChecks.map(({ icon: Icon, label, title, body }) => (
            <article key={label}>
              <Icon aria-hidden />
              <div>
                <span>{label}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
              <Check aria-hidden />
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.sectorCta} ${styles.nftCta}`}>
        <p className={styles.eyebrow}>Start with one collection</p>
        <h2>{solution.finalTitle}</h2>
        <p>{solution.finalBody}</p>
        <Link to={`${MARKETING_ROOT}/contact`}>
          Design the collection journey <ArrowRight aria-hidden />
        </Link>
      </section>
    </main>
  );
}
