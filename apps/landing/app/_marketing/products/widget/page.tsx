import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Code2 } from "lucide-react";
import { HumanDemo } from "../../sections/human-demo";
import {
  IntegrationInvariant,
  IntegrationShowcases,
} from "./integration-showcases";
import { WidgetInstallCode } from "./widget-install-code";
import pageStyles from "./widget-product.module.css";

const INSTALL_COMMAND = "npx shadcn add https://aomi.dev/r/aomi-frame.json";

export const metadata: Metadata = {
  title: "Widget | Aomi",
  description:
    "Embed Aomi's chat-to-transaction surface in your product with your authentication, wallet experience, and application policy.",
  robots: { index: false, follow: false },
};

const integrationChoices = [
  {
    title: "Browser wallets",
    body: "MetaMask, Rabby, Coinbase Wallet, WalletConnect, and the signer your users already know.",
  },
  {
    title: "Embedded wallets",
    body: "Register Para or Privy only when you want their authentication session and embedded-wallet experience.",
  },
  {
    title: "Application policy",
    body: "An Aomi application ID selects the backend-owned execution, sponsorship, and fee policy for every widget action.",
  },
] as const;

export function WidgetProductPageContent({
  contactHref = "/contact",
  productName = "AOMI WIDGET",
  flat = false,
}: {
  contactHref?: string;
  productName?: string;
  flat?: boolean;
}) {
  const telegramSection = (
    <section id="telegram" className={pageStyles.telegramSection}>
      <div className={pageStyles.shell}>
        <div className={pageStyles.flowGrid}>
          <div>
            <p className={pageStyles.eyebrow}>TELEGRAM</p>
            <h2>Set up integration with no code</h2>
            <p className={pageStyles.telegramLead}>
              Paste a BotFather token, attach your hosted plugin, and Aomi runs
              the bot. Every user chats on their own Aomi identity and
              wallet—and decides for themselves whether the agent may sign.
            </p>
            <a
              href="https://build.aomi.dev/integrations"
              target="_blank"
              rel="noreferrer"
              className={pageStyles.textLink}
            >
              Register a bot in Aomi Build
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </div>
          <ol className={pageStyles.flowSteps}>
            {[
              [
                "01",
                "Create the bot",
                "Message @BotFather, send /newbot, copy the token.",
              ],
              [
                "02",
                "Register it",
                "Paste the token and pick the apps it serves. Aomi verifies it with Telegram and activates the webhook.",
              ],
              [
                "03",
                "Users just chat",
                "Each person messages on their own Aomi identity, wallets, and threads. /app switches between attached apps.",
              ],
              [
                "04",
                "Users choose how the agent signs",
                "Agent wallets start unable to sign. /permission turns autonomous signing on—or back off—per user.",
              ],
            ].map(([number, title, body]) => (
              <li key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );

  const integrationContent = flat ? (
    <>
      <IntegrationShowcases flat segment="sommelier" />
      <IntegrationInvariant flat />
      <IntegrationShowcases
        flat
        segment="remaining"
        afterTrading={telegramSection}
      />
    </>
  ) : (
    <>
      <IntegrationInvariant />
      <IntegrationShowcases />
    </>
  );

  return (
    <main className={`${pageStyles.page} ${flat ? pageStyles.flatPage : ""}`}>
      <section className={pageStyles.hero}>
        <div className={pageStyles.shell}>
          <div className={pageStyles.heroGrid}>
            <div className={pageStyles.heroCopy}>
              <p className={pageStyles.eyebrow}>{productName}</p>
              <h1>One integration across every product surface.</h1>
              <p className={pageStyles.heroSupport}>
                Put the same chat-to-transaction experience used by Aomi Portal
                where your users already are: embedded in your product, or in a
                Telegram bot you register in minutes. Bring your application,
                authentication, and signer. Aomi brings the execution harness.
              </p>
              <div className={pageStyles.heroActions}>
                <Link href="#install" className={pageStyles.primaryButton}>
                  Start integrating
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
                <a
                  href="https://chat.aomi.dev"
                  target="_blank"
                  rel="noreferrer"
                  className={pageStyles.secondaryButton}
                >
                  Open live Portal
                </a>
              </div>
              <p className={pageStyles.heroNote}>
                Web widget · Telegram · Portal · EVM + Solana · browser, Para,
                or Privy authentication
              </p>
              <p className={pageStyles.heroProof}>
                <span>IN PRODUCTION</span> Sommelier ships its liquidity
                assistant on this surface.
              </p>
            </div>

            <div className={pageStyles.productStage}>
              <div className={pageStyles.stageHeader}>
                <span className={pageStyles.stageStatus}>
                  <span aria-hidden /> Live product surface
                </span>
                <span>chat.aomi.dev</span>
              </div>
              <div className={pageStyles.demoClip}>
                <HumanDemo />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={pageStyles.proofRail} aria-label="Widget facts">
        <div className={pageStyles.shell}>
          <div className={pageStyles.proofGrid}>
            <div>
              <span>Install</span>
              <strong>One component</strong>
            </div>
            <div>
              <span>Surfaces</span>
              <strong>Widget · Telegram · Portal</strong>
            </div>
            <div>
              <span>Networks</span>
              <strong>EVM + Solana</strong>
            </div>
            <div>
              <span>Keys held by Aomi</span>
              <strong>Zero</strong>
            </div>
          </div>
        </div>
      </section>

      {integrationContent}

      <section id="install" className={pageStyles.installSection}>
        <div className={pageStyles.shell}>
          <div className={pageStyles.installGrid}>
            <div className={pageStyles.installCopy}>
              <p className={pageStyles.eyebrow}>INSTALL AND CONFIGURE</p>
              <h2>Own the integration. Keep the execution runtime.</h2>
              <p>
                Install the shadcn source or the package, bind one application
                ID, and choose the authentication and wallets that already
                belong in your product.
              </p>
              <div className={pageStyles.commandBox} data-liquid-glass>
                <Code2 aria-hidden className="size-4" />
                <code>{INSTALL_COMMAND}</code>
              </div>
              <a
                href="https://aomi.dev/docs/"
                target="_blank"
                rel="noreferrer"
                className={pageStyles.textLink}
              >
                Read integration documentation
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
            </div>

            <WidgetInstallCode />
          </div>
        </div>
      </section>

      {!flat ? telegramSection : null}

      <section className={pageStyles.choiceSection}>
        <div className={pageStyles.shell}>
          <div className={pageStyles.choiceHeading}>
            <p className={pageStyles.eyebrow}>YOUR PRODUCT BOUNDARIES</p>
            <h2>Bring the identity and signer your users already trust.</h2>
          </div>
          <div className={pageStyles.choiceGrid}>
            {integrationChoices.map((choice) => (
              <article key={choice.title}>
                <span className={pageStyles.checkIcon} aria-hidden>
                  <Check className="size-4" strokeWidth={2} />
                </span>
                <div>
                  <h3>{choice.title}</h3>
                  <p>{choice.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={pageStyles.flowSection}>
        <div className={pageStyles.shell}>
          <div className={pageStyles.flowGrid}>
            <div>
              <p className={pageStyles.eyebrow}>THE EXECUTION BOUNDARY</p>
              <h2>A visible checkpoint at every stage.</h2>
            </div>
            <ol className={pageStyles.flowSteps}>
              {[
                ["01", "Intent", "Your user asks in plain language."],
                [
                  "02",
                  "Construct",
                  "Aomi resolves tools, venue, route, and calldata.",
                ],
                [
                  "03",
                  "Simulate",
                  "The complete action is rehearsed before approval.",
                ],
                [
                  "04",
                  "Sign",
                  "The user's existing wallet authorizes the exact payload.",
                ],
              ].map(([number, title, body]) => (
                <li key={number}>
                  <span>{number}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className={pageStyles.finalCta}>
        <div className={pageStyles.shell}>
          <div className={pageStyles.finalCtaInner}>
            <div>
              <p className={pageStyles.eyebrow}>SHIP THE SURFACE</p>
              <h2>Put Aomi where your users already are.</h2>
            </div>
            <div className={pageStyles.finalActions}>
              <a
                href="https://aomi.dev/docs/"
                target="_blank"
                rel="noreferrer"
                className={pageStyles.finalPrimary}
              >
                Start building
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
              <Link href={contactHref} className={pageStyles.finalSecondary}>
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function WidgetProductPage() {
  return <WidgetProductPageContent />;
}
