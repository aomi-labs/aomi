import type { Metadata } from "next";
import { ArrowRight, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { posts } from "@/lib/research";
import { MARKETING_ROOT } from "../site";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "Blog | Aomi",
  description: "Launches, announcements and notes from Aomi Labs.",
  robots: { index: false, follow: false },
};

const blogPosts = posts.map((post) => ({
  ...post,
  href: `/research/${post.slug}`,
}));
const [featured, ...rest] = blogPosts;

export default function BlogPage() {
  return (
    <main className={styles.editorialPage}>
      <header
        className={`${styles.editorialHero} ${styles.editorialHeroCompact} ${styles.newsHero}`}
      >
        <h1>Blog</h1>
      </header>

      <section className={styles.blogFeatured}>
        <Link href={featured.href}>
          <Image
            src={featured.cover}
            alt=""
            width={1600}
            height={900}
            priority
            sizes="(max-width: 800px) 100vw, 1200px"
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

      <section className={styles.blogList}>
        {rest.map((post) => (
          <Link href={post.href} key={post.slug}>
            <Image
              src={post.cover}
              alt=""
              width={480}
              height={270}
              sizes="(max-width: 800px) 100vw, 320px"
            />
            <span>
              <small>
                <span>{post.tag}</span>
                <time dateTime={post.isoDate}>{post.date}</time>
                <span>{post.readMinutes} min read</span>
              </small>
              <strong>{post.title}</strong>
              <p>{post.subtitle}</p>
            </span>
            <ArrowRight aria-hidden />
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
          <Link href={`${MARKETING_ROOT}/contact`}>
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
          <Link href={`${MARKETING_ROOT}/contact`}>contact the team</Link>.
        </p>
      </section>
    </main>
  );
}
