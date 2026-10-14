import { type LandingMetadata as Metadata } from "@/lib/metadata";
import styles from "../longform.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy | Aomi",
  description:
    "How Aomi Labs collects, uses, and safeguards information across the widget, API, and related tools.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Legal</p>
        <h1>Privacy Policy</h1>
        <p>
          How we collect, use, disclose, and safeguard your information when you
          use our blockchain AI infrastructure services.
        </p>
        <p className={styles.heroMeta}>Last updated: March 23, 2026</p>
      </header>

      <div className={styles.body}>
        <div className={styles.prose}>
          <h2>1. Introduction</h2>
          <p>
            Aomi Labs (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is
            committed to protecting your privacy. This Privacy Policy explains
            how we collect, use, disclose, and safeguard your information when
            you use our blockchain AI infrastructure services, including our
            widget, API, and related tools.
          </p>

          <h2>2. Information We Collect</h2>
          <h3>2.1 Information You Provide</h3>
          <ul>
            <li>Account information (email address, organization name)</li>
            <li>API keys and integration credentials</li>
            <li>Communications with our support team</li>
            <li>Feedback and survey responses</li>
          </ul>

          <h3>2.2 Automatically Collected Information</h3>
          <ul>
            <li>Usage data and analytics (API calls, feature usage)</li>
            <li>Device and browser information</li>
            <li>IP addresses and geolocation data</li>
            <li>Log data and error reports</li>
          </ul>

          <h3>2.3 Blockchain Data</h3>
          <p>
            We process publicly available blockchain data to provide our
            services. Wallet addresses and transaction data are used solely to
            execute your requested operations and are not stored longer than
            necessary for service delivery.
          </p>

          <h2>3. How We Use Your Information</h2>
          <ul>
            <li>To provide, maintain, and improve our services</li>
            <li>To process transactions and send related notifications</li>
            <li>To respond to your inquiries and support requests</li>
            <li>To detect, prevent, and address technical issues and fraud</li>
            <li>To comply with legal obligations</li>
            <li>
              To send service updates and marketing communications (with
              consent)
            </li>
          </ul>

          <h2>4. Data Sharing and Disclosure</h2>
          <p>
            We do not sell your personal information. We may share your data
            with:
          </p>
          <ul>
            <li>
              <strong>Service Providers:</strong> Third parties who assist in
              operating our services (hosting, analytics, support)
            </li>
            <li>
              <strong>Blockchain Networks:</strong> Transaction data is
              broadcast to public blockchain networks as required
            </li>
            <li>
              <strong>Legal Requirements:</strong> When required by law or to
              protect our rights
            </li>
            <li>
              <strong>Business Transfers:</strong> In connection with a merger,
              acquisition, or sale of assets
            </li>
          </ul>

          <h2>5. Data Security</h2>
          <p>
            We implement industry-standard security measures including
            encryption, access controls, and secure infrastructure. However, no
            method of transmission over the Internet is 100% secure, and we
            cannot guarantee absolute security.
          </p>

          <h2>6. Data Retention</h2>
          <p>
            We retain your information for as long as necessary to provide our
            services and fulfill the purposes outlined in this policy. Account
            data is retained until you request deletion. Some data may be
            retained longer for legal or legitimate business purposes.
          </p>

          <h2>7. Your Rights</h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul>
            <li>Access and receive a copy of your personal data</li>
            <li>Rectify inaccurate or incomplete data</li>
            <li>Request deletion of your personal data</li>
            <li>Object to or restrict processing of your data</li>
            <li>Data portability</li>
            <li>Withdraw consent at any time</li>
          </ul>
          <p>
            To exercise these rights, contact us at{" "}
            <a href="mailto:privacy@aomi.dev">privacy@aomi.dev</a>.
          </p>

          <h2>8. International Transfers</h2>
          <p>
            Your information may be transferred to and processed in countries
            other than your own. We ensure appropriate safeguards are in place
            for such transfers in accordance with applicable law.
          </p>

          <h2>9. Children&apos;s Privacy</h2>
          <p>
            Our services are not directed to individuals under 18. We do not
            knowingly collect personal information from children. If we become
            aware that we have collected data from a child, we will take steps
            to delete it.
          </p>

          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify
            you of material changes by posting the new policy on this page and
            updating the &quot;Last updated&quot; date.
          </p>

          <h2>11. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us
            at:
          </p>
          <div className={styles.contactCard}>
            <strong>Aomi Labs</strong>
            <p>
              Email: <a href="mailto:privacy@aomi.dev">privacy@aomi.dev</a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
