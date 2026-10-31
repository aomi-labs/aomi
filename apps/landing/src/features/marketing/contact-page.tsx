import { type LandingMetadata as Metadata } from "@/lib/metadata";
import {
  ArrowRight,
  Braces,
  Building2,
  Mail,
  MessageCircle,
  WalletCards,
} from "lucide-react";
import styles from "./marketing.module.css";

export const metadata: Metadata = {
  title: "Contact | Aomi",
  description:
    "Talk with Aomi Labs about products, integrations, and partnerships.",
  robots: { index: false, follow: false },
};

const paths = [
  {
    icon: Building2,
    title: "Product integration",
    body: "Bring a wallet, fintech, exchange, vault, marketplace, or protocol experience that needs governed execution.",
    prompt:
      "Tell us about the product surface, users, wallet boundary, and actions you want to support.",
  },
  {
    icon: Braces,
    title: "Developer platform",
    body: "Build an Aomi App, connect Agents API, call Pipeline API, or add Aomi to an existing agent system.",
    prompt:
      "Share the API, tool surface, execution environment, and the level of orchestration you want Aomi to own.",
  },
  {
    icon: WalletCards,
    title: "Execution architecture",
    body: "Design custody, signing, account abstraction, automation, simulation, and evidence for a production workflow.",
    prompt:
      "Describe the wallet providers, networks, policy, and proof of completion your workflow requires.",
  },
] as const;

export default function ContactPage() {
  return (
    <main className={styles.editorialPage}>
      <header className={`${styles.editorialHero} ${styles.contactHero}`}>
        <p className={styles.eyebrow}>Contact</p>
        <h1>Bring the execution problem.</h1>
        <p>
          We work with teams building trading, wallet, treasury, protocol, and
          agent workflows that need controlled onchain execution.
        </p>
        <div>
          <a href="mailto:contact@aomi.dev">
            <Mail aria-hidden /> contact@aomi.dev
          </a>
          <a href="https://chat.aomi.dev">
            <MessageCircle aria-hidden /> Open Aomi
          </a>
        </div>
      </header>

      <section className={styles.contactPaths}>
        {paths.map((path, index) => (
          <article key={path.title}>
            <div>
              <path.icon aria-hidden />
              <span>0{index + 1}</span>
            </div>
            <h2>{path.title}</h2>
            <p>{path.body}</p>
            <small>{path.prompt}</small>
          </article>
        ))}
      </section>

      <section className={styles.contactDirect}>
        <div>
          <p className={styles.eyebrow}>A useful first message</p>
          <h2>Context makes the first conversation faster.</h2>
        </div>
        <ul>
          <li>
            <span>01</span>The customer or operator job
          </li>
          <li>
            <span>02</span>The APIs, protocols, and networks involved
          </li>
          <li>
            <span>03</span>The wallet and signing authority
          </li>
          <li>
            <span>04</span>What counts as verified completion
          </li>
        </ul>
        <a href="mailto:contact@aomi.dev">
          Email the team <ArrowRight aria-hidden />
        </a>
      </section>
    </main>
  );
}
