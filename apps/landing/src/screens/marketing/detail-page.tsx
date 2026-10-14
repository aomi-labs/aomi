import {
  ArrowRight,
  BadgeCheck,
  Box,
  CircleDot,
  FileCheck2,
  Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { DetailPage as DetailPageConfig } from "./site";
import { products, solutions, MARKETING_ROOT } from "./site";
import styles from "./marketing.module.css";

const toneClass = {
  blue: styles.detailHeroBlue,
  pink: styles.detailHeroPink,
  green: styles.detailHeroGreen,
  ink: styles.detailHeroInk,
} as const;

export function DetailPage({
  page,
  kind,
}: {
  page: DetailPageConfig;
  kind: "product" | "solution";
}) {
  const related = (kind === "product" ? products : solutions)
    .filter((item) => item.slug !== page.slug)
    .slice(0, 3);

  return (
    <main className={styles.detailPage}>
      <header className={`${styles.detailHero} ${toneClass[page.tone]}`}>
        <div className={styles.detailHeroGrid} aria-hidden />
        <div className={styles.detailHeroInner}>
          <p className={styles.eyebrow}>{page.eyebrow}</p>
          <h1>{page.headline}</h1>
          <p>{page.summary}</p>
          <div className={styles.detailHeroActions}>
            <Link to={`${MARKETING_ROOT}/contact`}>
              Talk to the team <ArrowRight aria-hidden />
            </Link>
            <a href="https://aomi.dev/docs/">Read documentation</a>
          </div>
        </div>
        <div className={styles.detailHeroSignal}>
          <span>
            <Sparkles aria-hidden /> Execution harness
          </span>
          <div className={styles.detailHeroSignalMap}>
            {page.capabilities.map((capability, index) => (
              <span key={capability.title}>
                <i />
                <small>{String(index + 1).padStart(2, "0")}</small>
              </span>
            ))}
          </div>
          <strong>{page.title}</strong>
          <small>
            {page.capabilities.map(({ title }) => title).join(" · ")}
          </small>
        </div>
      </header>

      <section className={styles.detailContext}>
        <div>
          <span>Built for</span>
          <p>{page.audience}</p>
        </div>
        <div>
          <span>What it proves</span>
          <p>{page.proof}</p>
        </div>
      </section>

      <section className={styles.detailCapabilities}>
        <div className={styles.detailSectionLead}>
          <p className={styles.eyebrow}>Capabilities</p>
          <h2>The execution boundary stays explicit.</h2>
          <p>
            Each layer has one job, one authority, and evidence that the next
            layer can verify.
          </p>
        </div>
        <div className={styles.detailCapabilityGrid}>
          {page.capabilities.map((capability, index) => (
            <article key={capability.title}>
              <div>
                <Box aria-hidden />
                <span>0{index + 1}</span>
              </div>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.detailFlow}>
        <div className={styles.detailSectionLeadLight}>
          <p className={styles.eyebrow}>Lifecycle</p>
          <h2>From context to verifiable completion.</h2>
        </div>
        <div className={styles.detailFlowSteps}>
          {page.flow.map((step, index) => (
            <article key={step.title}>
              <div>
                <CircleDot aria-hidden />
                <span>{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
        <div className={styles.detailFlowReceipt}>
          <FileCheck2 aria-hidden />
          <span>
            Completion means receipt, events, and resulting state—not a queued
            request.
          </span>
        </div>
      </section>

      <section className={styles.relatedSection}>
        <div className={styles.detailSectionLead}>
          <p className={styles.eyebrow}>Keep exploring</p>
          <h2>One harness, multiple product boundaries.</h2>
        </div>
        <div className={styles.relatedGrid}>
          {related.map((item) => (
            <Link to={kind === "product" ? "/products/$slug" : "/solutions/$slug"} params={{slug: item.slug}} key={item.slug}>
              <span>{kind === "product" ? "Product" : "Solution"}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <strong>
                Explore <ArrowRight aria-hidden />
              </strong>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.detailCta}>
        <BadgeCheck aria-hidden />
        <p className={styles.eyebrow}>Design the boundary</p>
        <h2>Bring the product. Keep the authority. Use the harness.</h2>
        <Link to={`${MARKETING_ROOT}/contact`}>
          Start an integration conversation <ArrowRight aria-hidden />
        </Link>
      </section>
    </main>
  );
}
