import {
  ArrowRight,
  ArrowUpRight,
  Layers3,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { SolutionConfig } from "../marketing-templates/solutions/solution-data";
import { SolutionShowcase } from "./components/solution-showcase";
import { MARKETING_ROOT } from "./site";
import styles from "./marketing.module.css";

const needIcons = [ShieldCheck, Layers3, ReceiptText] as const;

const productHref = (href: string) => {
  const slug = href.split("/").pop();
  const translated = {
    widget: "widget",
    api: "rest-apis",
    "cli-mcp": "agentic-toolings",
    console: "plugin-sdk",
  }[slug ?? ""];
  return translated
    ? `${MARKETING_ROOT}/products/${translated}`
    : `${MARKETING_ROOT}/products`;
};

export function SolutionPage({ solution }: { solution: SolutionConfig }) {
  return (
    <main className={styles.solutionPage}>
      <section className={styles.solutionHero}>
        <div className={styles.solutionHeroGrid} aria-hidden />
        <div className={styles.solutionHeroCopy}>
          <p className={styles.eyebrow}>{solution.eyebrow}</p>
          <h1>{solution.headline}</h1>
          <p className={styles.solutionLede}>{solution.lede}</p>
          <div className={styles.detailHeroActions}>
            <Link to={`${MARKETING_ROOT}/contact`}>
              Design your workflow <ArrowRight aria-hidden />
            </Link>
            <Link to={`${MARKETING_ROOT}/products/rest-apis`}>
              Explore the APIs
            </Link>
          </div>
        </div>
        <SolutionShowcase solution={solution} />
      </section>

      <section className={styles.solutionProof} aria-label="Product guarantees">
        <div className={styles.solutionProofAudience}>
          <span>Built for</span>
          <p>{solution.audience}</p>
        </div>
        {solution.proof.map((item, index) => (
          <div key={item}>
            <span>0{index + 1}</span>
            <strong>{item}</strong>
          </div>
        ))}
      </section>

      <section className={styles.solutionNeeds}>
        <header className={styles.solutionSectionHeader}>
          <div>
            <p className={styles.eyebrow}>{solution.valueEyebrow}</p>
            <h2>{solution.valueTitle}</h2>
          </div>
          <p>{solution.valueIntro}</p>
        </header>
        <div className={styles.solutionNeedGrid}>
          {solution.needs.map((need, index) => {
            const Icon = needIcons[index] ?? Layers3;
            return (
              <article key={need.title}>
                <div>
                  <Icon aria-hidden />
                  <span>0{index + 1}</span>
                </div>
                <h3>{need.title}</h3>
                <p>{need.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.solutionFlow}>
        <header className={styles.solutionFlowHeader}>
          <p className={styles.eyebrow}>The execution boundary</p>
          <h2>{solution.flowTitle}</h2>
          <p>{solution.flowIntro}</p>
        </header>
        <ol>
          {solution.flow.map((step) => (
            <li key={step.label}>
              <span>{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.solutionPaths}>
        <header className={styles.solutionSectionHeader}>
          <div>
            <p className={styles.eyebrow}>Choose your surface</p>
            <h2>Meet the customer where they already work.</h2>
          </div>
          <p>
            The surface can change without changing the guarded execution
            contract underneath it.
          </p>
        </header>
        <div className={styles.solutionPathGrid}>
          {solution.paths.map((path) => (
            <Link
              key={`${path.name}-${path.title}`}
              to={productHref(path.href)}
            >
              <div>
                <strong>{path.name}</strong>
                <span>{path.badge}</span>
              </div>
              <h3>{path.title}</h3>
              <p>{path.body}</p>
              <small>
                Explore surface <ArrowUpRight aria-hidden />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.solutionCta}>
        <p className={styles.eyebrow}>Build with Aomi</p>
        <h2>{solution.finalTitle}</h2>
        <p>{solution.finalBody}</p>
        <div>
          <Link to={`${MARKETING_ROOT}/contact`}>
            Talk to the team <ArrowRight aria-hidden />
          </Link>
          <Link to={`${MARKETING_ROOT}/products/rest-apis`}>
            Read the API overview
          </Link>
        </div>
      </section>
    </main>
  );
}
