import { type LandingMetadata as Metadata } from "@/lib/metadata";
import styles from "./longform.module.css";

export const metadata: Metadata = {
  title: "Terms of Service | Aomi",
  description:
    "The terms governing use of Aomi Labs' widget, API, SDK, and related developer tools.",
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Legal</p>
        <h1>Terms of Service</h1>
        <p>
          The agreement that governs your use of the Aomi widget, API, SDK, and
          related developer tools.
        </p>
        <p className={styles.heroMeta}>Last updated: March 23, 2026</p>
      </header>

      <div className={styles.body}>
        <div className={styles.prose}>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using Aomi Labs&apos; services, including our
            widget, API, SDK, and related tools (collectively, the
            &quot;Services&quot;), you agree to be bound by these Terms of
            Service (&quot;Terms&quot;). If you do not agree to these Terms, do
            not use our Services.
          </p>
          <p>
            If you are using our Services on behalf of an organization, you
            represent that you have the authority to bind that organization to
            these Terms.
          </p>

          <h2>2. Description of Services</h2>
          <p>
            Aomi provides blockchain AI infrastructure that enables developers
            to integrate AI-powered features into their applications. Our
            Services include:
          </p>
          <ul>
            <li>Embeddable widget for blockchain interactions</li>
            <li>API and SDK for programmatic access</li>
            <li>
              AI-powered transaction processing and natural language interfaces
            </li>
            <li>Developer documentation and tools</li>
          </ul>

          <h2>3. Account Registration</h2>
          <p>
            To access certain features, you must create an account. You agree
            to:
          </p>
          <ul>
            <li>Provide accurate, current, and complete information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Promptly update your information if it changes</li>
            <li>Accept responsibility for all activities under your account</li>
            <li>Notify us immediately of any unauthorized access</li>
          </ul>

          <h2>4. Acceptable Use</h2>
          <p>You agree not to use our Services to:</p>
          <ul>
            <li>Violate any applicable laws or regulations</li>
            <li>Engage in money laundering, fraud, or terrorist financing</li>
            <li>Circumvent sanctions or trade restrictions</li>
            <li>Infringe on intellectual property rights</li>
            <li>Transmit malicious code or interfere with our systems</li>
            <li>Attempt to gain unauthorized access to our Services</li>
            <li>
              Use automated means to access our Services without permission
            </li>
            <li>Engage in market manipulation or wash trading</li>
          </ul>

          <h2>5. API and SDK Usage</h2>
          <p>Your use of our API and SDK is subject to:</p>
          <ul>
            <li>
              Rate limits and usage quotas as specified in our documentation
            </li>
            <li>Our API documentation and guidelines</li>
            <li>Attribution requirements where applicable</li>
            <li>Prohibition on reselling API access without authorization</li>
          </ul>
          <p>
            We reserve the right to modify, suspend, or discontinue API features
            with reasonable notice.
          </p>

          <h2>6. Fees and Payment</h2>
          <p>
            Some Services may require payment. By using paid Services, you agree
            to:
          </p>
          <ul>
            <li>Pay all applicable fees as specified</li>
            <li>Provide accurate billing information</li>
            <li>Authorize us to charge your payment method</li>
          </ul>
          <p>
            Fees are non-refundable except as required by law or as otherwise
            stated.
          </p>

          <h2>7. Blockchain Transactions</h2>
          <div className={styles.callout}>
            <p>
              <strong>Important:</strong> Blockchain transactions are
              irreversible. You are solely responsible for verifying transaction
              details before confirming.
            </p>
          </div>
          <p>You acknowledge that:</p>
          <ul>
            <li>Blockchain transactions cannot be reversed once confirmed</li>
            <li>
              Network fees (gas) are determined by the blockchain network, not
              by us
            </li>
            <li>Transaction timing depends on network conditions</li>
            <li>
              You are responsible for maintaining secure custody of your private
              keys
            </li>
            <li>
              We do not custody your assets or have access to your private keys
            </li>
          </ul>

          <h2>8. AI-Generated Content</h2>
          <p>
            Our Services use artificial intelligence to process natural language
            and generate responses. You acknowledge that:
          </p>
          <ul>
            <li>AI outputs may not always be accurate or complete</li>
            <li>
              You should verify AI-generated information before taking action
            </li>
            <li>
              AI suggestions are not financial, legal, or investment advice
            </li>
            <li>
              You are responsible for reviewing and approving all transactions
            </li>
          </ul>

          <h2>9. Intellectual Property</h2>
          <p>
            Our Services, including software, documentation, trademarks, and
            content, are owned by Aomi Labs and protected by intellectual
            property laws. We grant you a limited, non-exclusive,
            non-transferable license to use our Services in accordance with
            these Terms.
          </p>
          <p>
            You retain ownership of your data and content. By using our
            Services, you grant us a license to process your data as necessary
            to provide the Services.
          </p>

          <h2>10. Disclaimer of Warranties</h2>
          <div className={styles.callout}>
            <p>
              OUR SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
              IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
              NON-INFRINGEMENT.
            </p>
          </div>
          <p>
            We do not guarantee that our Services will be uninterrupted, secure,
            or error-free.
          </p>

          <h2>11. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, AOMI LABS SHALL NOT BE
            LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS,
            DATA, OR DIGITAL ASSETS, ARISING FROM YOUR USE OF OUR SERVICES.
          </p>
          <p>
            Our total liability shall not exceed the greater of (a) the amount
            you paid us in the 12 months preceding the claim, or (b) $100.
          </p>

          <h2>12. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Aomi Labs and its officers,
            directors, employees, and agents from any claims, damages, losses,
            or expenses arising from your use of our Services or violation of
            these Terms.
          </p>

          <h2>13. Termination</h2>
          <p>
            We may suspend or terminate your access to our Services at any time
            for any reason, including violation of these Terms. You may
            terminate your account at any time by contacting us.
          </p>
          <p>
            Upon termination, your right to use our Services ceases immediately.
            Sections that by their nature should survive termination shall
            survive.
          </p>

          <h2>14. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with
            the laws of the State of Delaware, United States, without regard to
            conflict of law principles.
          </p>

          <h2>15. Changes to Terms</h2>
          <p>
            We may modify these Terms at any time. We will notify you of
            material changes by posting the updated Terms and updating the
            &quot;Last updated&quot; date. Your continued use of our Services
            constitutes acceptance of the modified Terms.
          </p>

          <h2>16. Contact Us</h2>
          <p>If you have questions about these Terms, please contact us at:</p>
          <div className={styles.contactCard}>
            <strong>Aomi Labs</strong>
            <p>
              Email: <a href="mailto:legal@aomi.dev">legal@aomi.dev</a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
