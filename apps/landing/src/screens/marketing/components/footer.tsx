import { ArrowUpRight, Github, Linkedin } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AomiLogo } from "../../components/aomi-logo";
import { products, resources, solutions, MARKETING_ROOT } from "../site";
import styles from "../marketing.module.css";

export function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerLead}>
          <AomiLogo
            className={styles.footerLogo}
            markClassName={styles.footerLogoMark}
            wordmarkClassName={styles.footerLogoWord}
          />
          <p>
            Execution infrastructure for onchain finance. Agent-driven
            settlement with institutional-grade controls. Non-custodial and
            wallet agnostic.
          </p>
          <Link
            to={`${MARKETING_ROOT}/contact`}
            className={styles.footerContact}
          >
            Start a conversation <ArrowUpRight aria-hidden />
          </Link>
        </div>

        <div className={styles.footerColumns}>
          <div>
            <p className={styles.footerLabel}>Products</p>
            {products.map((item) => (
              <Link to={item.href} key={item.slug}>
                {item.title}
              </Link>
            ))}
          </div>
          <div>
            <p className={styles.footerLabel}>Solutions</p>
            {solutions.map((item) => (
              <Link to="/solutions/$slug" params={{slug: item.slug}} key={item.slug}>
                {item.title}
              </Link>
            ))}
          </div>
          <div>
            <p className={styles.footerLabel}>Company</p>
            {resources.map((item) => (
              <Link to={item.href} key={item.title}>
                {item.title}
              </Link>
            ))}
          </div>
          <div>
            <p className={styles.footerLabel}>Legal</p>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href="https://aomi.dev/docs/">Documentation</a>
          </div>
        </div>
      </div>

      <div className={styles.footerBar}>
        <span>© 2026 Aomi Labs. All rights reserved.</span>
        <div>
          <a href="https://x.com/aomi_labs" aria-label="Aomi on X">
            X
          </a>
          <a
            href="https://www.linkedin.com/company/aomi-labs/"
            aria-label="Aomi on LinkedIn"
          >
            <Linkedin aria-hidden />
          </a>
          <a href="https://github.com/aomi-labs" aria-label="Aomi on GitHub">
            <Github aria-hidden />
          </a>
        </div>
      </div>
    </footer>
  );
}
