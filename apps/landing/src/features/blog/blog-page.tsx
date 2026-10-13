import type { LandingMetadata as Metadata } from "@/lib/metadata";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { posts } from "@/lib/research";
import { MARKETING_ROOT } from "@/features/marketing/site";
import styles from "@/features/marketing/marketing.module.css";

export const metadata: Metadata = {
  title: "Blog | Aomi",
  description: "Launches, announcements and notes from Aomi Labs.",
  robots: { index: false, follow: false },
};

const [featured, ...rest] = posts;

export default function BlogPage() {
  return (
    <main className={styles.editorialPage}>
      <header
        className={`${styles.editorialHero} ${styles.editorialHeroCompact} ${styles.newsHero}`}
      >
        <h1>Blog</h1>
      </header>

      <section className={styles.blogFeatured}>
        <Link
          to="/research/$slug"
          params={{ slug: featured.slug }}
          data-tag={featured.tag}
        >
          <img
            src={featured.cover}
            alt=""
            width={1600}
            height={900}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
          <div>
            <small>
              <span>{featured.tag}</span>
              <time dateTime={featured.isoDate}>{featured.date}</time>
              <span>{featured.readMinutes} min read</span>
            </small>
            <h2>{featured.title}</h2>
            <p>{featured.subtitle}</p>
            <strong>
              Read more <ArrowRight aria-hidden />
            </strong>
          </div>
        </Link>
      </section>

      <section className={styles.blogGrid}>
        {rest.map((post) => (
          <Link
            to="/research/$slug"
            params={{ slug: post.slug }}
            key={post.slug}
            data-tag={post.tag}
          >
            <img
              src={post.cover}
              alt=""
              width={800}
              height={450}
              loading="lazy"
              decoding="async"
            />
            <small>
              <span>{post.tag}</span>
              <time dateTime={post.isoDate}>{post.date}</time>
              <span>{post.readMinutes} min read</span>
            </small>
            <strong>{post.title}</strong>
            <p>{post.subtitle}</p>
            <em>
              Read more <ArrowRight aria-hidden />
            </em>
          </Link>
        ))}
      </section>

      <section className={styles.editorialCta}>
        <p className={styles.eyebrow}>Build on Aomi</p>
        <h2>Ready to put verified execution behind your agent?</h2>
        <div>
          <a href="/docs">
            Read the docs <ArrowRight aria-hidden />
          </a>
          <Link to={`${MARKETING_ROOT}/contact`}>
            Contact Aomi <ArrowRight aria-hidden />
          </Link>
        </div>
      </section>

      <section className={styles.newsletter}>
        <div>
          <p className={styles.eyebrow}>Newsletter</p>
          <h2>Get new posts and research by email.</h2>
          <p>
            We publish on Substack. No product drip, only the posts that appear
            here.
          </p>
        </div>
        <a href="https://substack.com/@aomilabs">
          Follow on Substack <ExternalLink aria-hidden />
        </a>
        <p>
          Press and partnerships:{" "}
          <Link to={`${MARKETING_ROOT}/contact`}>contact the team</Link>.
        </p>
      </section>
    </main>
  );
}
