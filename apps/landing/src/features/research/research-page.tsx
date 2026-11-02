import type { LandingMetadata as Metadata } from "@/lib/metadata";
import { ArrowRight, Fingerprint, Gauge, Network } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { researchPosts, type ResearchPost } from "@/lib/research";
import styles from "@/features/marketing/marketing.module.css";

export const metadata: Metadata = {
  title: "Research | Aomi",
  description:
    "Aomi research on authentication, evaluation, and onchain execution systems.",
  robots: { index: false, follow: false },
};

const groupOrder = ["research", "engineering", "benchmark"] as const;
const groupLabel: Record<(typeof groupOrder)[number], string> = {
  research: "Papers",
  engineering: "Engineering",
  benchmark: "Benchmarks",
};

const groups = groupOrder
  .map((tag) => ({
    tag,
    label: groupLabel[tag],
    posts: researchPosts.filter((post) => post.tag === tag),
  }))
  .filter((group) => group.posts.length > 0);

function ResearchRow({ post }: { post: ResearchPost }) {
  return (
    <Link
      to="/research/$slug"
      params={{ slug: post.slug }}
      className={styles.researchRow}
    >
      <img
        src={post.cover}
        alt=""
        width={480}
        height={270}
        loading="lazy"
        decoding="async"
      />
      <span>
        <small>
          <time dateTime={post.isoDate}>{post.date}</time>
        </small>
        <strong>{post.title}</strong>
        <p>{post.subtitle}</p>
      </span>
      <ArrowRight aria-hidden />
    </Link>
  );
}

export default function ResearchPage() {
  return (
    <main className={styles.editorialPage}>
      <header
        className={`${styles.editorialHero} ${styles.editorialHeroCompact} ${styles.researchHero}`}
      >
        <h1>Research</h1>
      </header>

      <section className={styles.researchGroups}>
        {groups.map((group) => (
          <div key={group.tag} className={styles.researchGroup}>
            <p className={styles.eyebrow}>{group.label}</p>
            <div>
              {group.posts.map((post) => (
                <ResearchRow post={post} key={post.slug} />
              ))}
            </div>
          </div>
        ))}
      </section>

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
            Study construction, rehearsal, policy, signing, settlement, and
            evidence as one system.
          </p>
        </article>
      </section>
    </main>
  );
}
