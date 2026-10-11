import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { ArrowRight, ExternalLink, Newspaper, Radio } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MARKETING_ROOT } from "../site";
import styles from "../marketing.module.css";

export const metadata: Metadata = {
  title: "News | Aomi",
  description: "Published work and updates from Aomi Labs.",
  robots: { index: false, follow: false },
};

const notes = [
  {
    type: "Research",
    date: "July 13, 2026",
    title: "One User, Many Wallets",
    body: "A design study in hybrid crypto authentication and the proofs that must remain distinct.",
    href: "/research/auth-across-two-worlds",
  },
  {
    type: "Benchmark",
    date: "June 4, 2026",
    title: "AomiBench v0.1",
    body: "A wallet-aware harness for measuring frontier agents on real onchain tasks and chain-state evidence.",
    href: "/research/aomibench-v0-1",
  },
  {
    type: "Product",
    date: "Product preview",
    title: "Execution infrastructure, made legible",
    body: "A new product system for the surfaces, policies, and receipts between model intent and settlement.",
    href: "/",
  },
] as const;

export default function NewsPage() {
  return (
    <main className={styles.editorialPage}>
      <header className={`${styles.editorialHero} ${styles.newsHero}`}>
        <p className={styles.eyebrow}>News</p>
        <h1>Company notes and published work.</h1>
        <p>
          Follow what Aomi is building, testing, and learning about agentic
          onchain execution.
        </p>
        <a href="https://substack.com/@aomilabs">
          Follow Aomi Labs <ExternalLink aria-hidden />
        </a>
      </header>

      <section className={styles.newsGrid}>
        {notes.map((note, index) => (
          <a
            href={note.href}
            key={note.title}
            className={index === 0 ? styles.newsPrimary : ""}
          >
            <div>
              <Newspaper aria-hidden />
              <span>{note.type}</span>
              <small>{note.date}</small>
            </div>
            <h2>{note.title}</h2>
            <p>{note.body}</p>
            <strong>
              Read more <ArrowRight aria-hidden />
            </strong>
          </a>
        ))}
      </section>

      <section className={styles.newsSignal}>
        <Radio aria-hidden />
        <div>
          <p className={styles.eyebrow}>Press and partnerships</p>
          <h2>Looking for company context or an integration briefing?</h2>
        </div>
        <Link to={`${MARKETING_ROOT}/contact`}>
          Contact Aomi <ArrowRight aria-hidden />
        </Link>
      </section>
    </main>
  );
}
