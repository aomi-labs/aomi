import type { Metadata } from "next";
import {
  ArrowRight,
  BookOpen,
  Fingerprint,
  Gauge,
  Network,
} from "lucide-react";
import Link from "next/link";
import { researchPosts } from "@/lib/research";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "Research | Aomi",
  description:
    "Aomi research on authentication, evaluation, and onchain execution systems.",
  robots: { index: false, follow: false },
};

const publishedResearch = researchPosts.map((post) => ({
  ...post,
  href: `/research/${post.slug}`,
}));

export default function ResearchPage() {
  return (
    <main className={styles.editorialPage}>
      <header className={`${styles.editorialHero} ${styles.researchHero}`}>
        <p className={styles.eyebrow}>Research</p>
        <h1>Evidence for the systems agents depend on.</h1>
        <p>
          We study the boundaries that make financial agents useful: identity,
          wallet context, tool use, simulation, authorization, evaluation, and
          verifiable execution.
        </p>
      </header>

      <section className={styles.researchFocus}>
        <article>
          <Fingerprint aria-hidden />
          <span>Identity</span>
          <p>
            Keep account, wallet ownership, provider sessions, and delegated
            authority as separate proofs.
          </p>
        </article>
        <article>
          <Gauge aria-hidden />
          <span>Evaluation</span>
          <p>
            Measure model performance on executable onchain tasks, not only
            plausible text.
          </p>
        </article>
        <article>
          <Network aria-hidden />
          <span>Execution</span>
          <p>
            Study construction, simulation, policy, signing, settlement, and
            evidence as one system.
          </p>
        </article>
      </section>

      <section className={styles.researchList}>
        <div className={styles.detailSectionLead}>
          <p className={styles.eyebrow}>Published work</p>
          <h2>Research notes and benchmarks</h2>
        </div>
        <div>
          {publishedResearch.map((post, index) => (
            <Link href={post.href} key={post.slug}>
              <span className={styles.researchNumber}>0{index + 1}</span>
              <span className={styles.researchIcon}>
                <BookOpen aria-hidden />
              </span>
              <span>
                <small>
                  {post.tag} · {post.date}
                </small>
                <strong>{post.title}</strong>
                <p>{post.subtitle}</p>
              </span>
              <ArrowRight aria-hidden />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
