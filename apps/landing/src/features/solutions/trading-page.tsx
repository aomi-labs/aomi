import { ArrowDown } from "lucide-react";
import styles from "./trading-world.module.css";
import { WorldMarketsExample } from "./world-markets-example";

export function TradingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Aomi for trading UX</p>
          <h1>Automate trading with ready‑to‑go integrations</h1>
          <p className={styles.heroSubtitle}>plus expanded action space</p>
          <p className={styles.heroIntro}>
            Connect the trading surfaces your users already rely on to
            Aomi&apos;s execution runtime. Your product or agent keeps the
            strategy and selects the trade; Aomi prepares, simulates, and
            carries the approved action through the existing signer to a
            verified result.
          </p>
          <a className={styles.heroCta} href="#world-markets-example">
            See an integration example <ArrowDown aria-hidden />
          </a>
        </div>

        <figure className={styles.productStack}>
          <div className={styles.buildScreen}>
            <img
              src="/assets/landing/solutions/trading/aomi-build-create.png"
              alt="Aomi Build screen for creating an agent from a prompt or template"
              width={2602}
              height={1348}
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </div>
          <div className={styles.integrationScreen}>
            <img
              src="/assets/landing/solutions/trading/aomi-build-integrations.png"
              alt="Aomi Build Integrations screen showing Telegram setup, BotFather commands, and an attached app"
              width={2328}
              height={1964}
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </div>
        </figure>
      </section>

      <WorldMarketsExample presentation="storyboard" />
    </main>
  );
}
