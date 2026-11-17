import { ArrowRight, ArrowUpRight } from "lucide-react";
import { type LandingMetadata as Metadata } from "@/lib/metadata";
import { PackageFileExplorer } from "./package-file-explorer";
import { OperateWorkbench } from "./operate-workbench";
import { PolymarketPackageDemo } from "./polymarket-package-demo";
import styles from "./package-sdk-marketing.module.css";

export const metadata: Metadata = {
  title: "Package SDK | Aomi",
  description:
    "An Aomi Agent is a Rust package: a role, a small set of typed tools, and a workflow. Author it with aomi-sdk, ship it with Aomi Build, and operate it on build.aomi.dev.",
  robots: { index: false, follow: false },
};

export default function PackageSdkPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>AOMI PACKAGE SDK</p>
              <h1>Bring your API. Ship an agent that can transact.</h1>
              <p className={styles.heroLede}>
                Package your proprietary product context and API operations as
                typed tools. Aomi hosts the agent, manages its releases, and
                connects every selected tool call to the transaction pipeline
                shared across Aomi surfaces.
              </p>
            </div>
            <div className={styles.heroAside}>
              <p>
                Developers build the <strong>polymarket-trader</strong> package,
                which reads their market API and hands the selected order to
                Aomi for construction, simulation, policy checks, and
                signer-controlled submission.
              </p>
              <div className={styles.heroActions}>
                <a
                  className={styles.btnPrimary}
                  href="https://aomi.dev/docs/build/packages/aomi-agent"
                  target="_blank"
                  rel="noreferrer"
                >
                  Build your first Agent <ArrowUpRight aria-hidden />
                </a>
                <a
                  className={styles.btnSecondary}
                  href="https://aomi.dev/docs/build/packages/rust-sdk"
                  target="_blank"
                  rel="noreferrer"
                >
                  Rust SDK reference <ArrowRight aria-hidden />
                </a>
              </div>
            </div>
          </div>
          <PolymarketPackageDemo />
        </div>
      </section>

      <section className={`${styles.section} ${styles.capabilitySection}`}>
        <div className={styles.shell}>
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>
              ONE RUNTIME · TWO CAPABILITY LAYERS
            </p>
            <h2>
              Your API supplies the product. Aomi supplies the transaction path.
            </h2>
            <p>
              Each Aomi Agent is a Rust program composed of a role, typed tools,
              and a workflow. Aomi loads it in the hosted runtime, invokes the
              appropriate tool, and routes the resulting action into the
              transaction pipeline.
            </p>
          </header>

          <PackageFileExplorer />
        </div>
      </section>

      <section className={styles.operate}>
        <div className={styles.shell}>
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>OPERATE · BUILD.AOMI.DEV</p>
            <h2>
              Institution-grade monitoring for transactions, tool calls, and
              fees.
            </h2>
            <p>
              Aomi Build keeps every release tied to its repository,
              compatibility status, runtime lifecycle, tool health, transaction
              outcomes, and operating cost.
            </p>
          </header>

          <OperateWorkbench />

          <div className={styles.operateActions}>
            <a
              className={styles.btnPrimary}
              href="https://build.aomi.dev/"
              target="_blank"
              rel="noreferrer"
            >
              Open Aomi Build <ArrowUpRight aria-hidden />
            </a>
            <a
              className={styles.btnSecondary}
              href="https://aomi.dev/docs/build/packages/aomi-agent"
              target="_blank"
              rel="noreferrer"
            >
              Read the docs <ArrowRight aria-hidden />
            </a>
            <p className={styles.operateNote}>
              deterministic fixtures · no live account is contacted
            </p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.shell}>
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>BUILD → TEST → DEPLOY → OPERATE</p>
            <h2>Integration tooling and deployment pipeline.</h2>
            <p>
              The same toolchain carries a package from a platform-compatible
              build through local model testing, hosted activation, and the
              operational evidence that follows.
            </p>
          </header>

          <div
            className={styles.toolchainPipeline}
            aria-label="Aomi Agent delivery pipeline"
          >
            <a
              className={styles.pipelineStage}
              href="https://aomi.dev/docs/build/toolchain/aomi-build"
              target="_blank"
              rel="noreferrer"
            >
              <div className={styles.pipelineStageMeta}>
                <span>01</span>
                <code>aomi-build</code>
              </div>
              <h3>Build</h3>
              <p>
                Check the platform SDK, then scaffold or compile the package as
                a loadable <code>cdylib</code>.
              </p>
              <strong>aomi-build compile</strong>
            </a>

            <span className={styles.pipelineConnector} aria-hidden>
              <i />
              <ArrowRight />
            </span>

            <a
              className={styles.pipelineStage}
              href="https://aomi.dev/docs/build/toolchain/cargo test"
              target="_blank"
              rel="noreferrer"
            >
              <div className={styles.pipelineStageMeta}>
                <span>02</span>
                <code>cargo test</code>
              </div>
              <h3>Test</h3>
              <p>
                Test the package locally and validate its tool contracts before
                shipping.
              </p>
              <strong>
                cargo test --manifest-path packages/polymarket-trader/Cargo.toml
              </strong>
            </a>

            <span className={styles.pipelineConnector} aria-hidden>
              <i />
              <ArrowRight />
            </span>

            <a
              className={styles.pipelineStage}
              href="https://aomi.dev/docs/build/toolchain/aomi-build"
              target="_blank"
              rel="noreferrer"
            >
              <div className={styles.pipelineStageMeta}>
                <span>03</span>
                <code>release</code>
              </div>
              <h3>Deploy</h3>
              <p>
                Publish the connected source, let CI cut the release, and
                activate the verified artifact in Aomi&apos;s hosted runtime.
              </p>
              <strong>aomi-build deploy</strong>
            </a>

            <span className={styles.pipelineConnector} aria-hidden>
              <i />
              <ArrowRight />
            </span>

            <a
              className={styles.pipelineStage}
              href="https://aomi.dev/docs/build/developer-platform"
              target="_blank"
              rel="noreferrer"
            >
              <div className={styles.pipelineStageMeta}>
                <span>04</span>
                <code>build.aomi.dev</code>
              </div>
              <h3>Operate</h3>
              <p>
                Track deployment and compatibility status, activation, tool
                health, usage, logs, metrics, and channel integrations.
              </p>
              <strong>status · logs · metrics</strong>
            </a>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.managedPlatformSection}`}>
        <div className={styles.shell}>
          <div className={styles.managedPlatformLayout}>
            <div className={styles.managedPlatformCopy}>
              <p className={styles.eyebrow}>
                THE MANAGED DESTINATION · BUILD.AOMI.DEV
              </p>
              <h2>Developer console just like Vercel</h2>
              <p>
                Build and deploy end at Aomi Build: the managed control plane
                that keeps the repository, release, hosted runtime, and
                operating evidence together for every Agent. It is where teams
                manage what is live, what ships next, and how each Agent
                performs.
              </p>
              <a
                className={styles.btnPrimary}
                href="https://build.aomi.dev/"
                target="_blank"
                rel="noreferrer"
              >
                Manage your Agents <ArrowUpRight aria-hidden />
              </a>

              <ol className={styles.managedPlatformSteps}>
                <li>
                  <span>01</span>
                  <strong>Connect the repository</strong>
                </li>
                <li>
                  <span>02</span>
                  <strong>Manage every release</strong>
                </li>
                <li>
                  <span>03</span>
                  <strong>Operate the live Agent</strong>
                </li>
              </ol>
            </div>

            <div
              className={styles.managedPlatformStack}
              aria-label="Aomi Build managed platform views"
            >
              <figure
                className={`${styles.managedPlatformFrame} ${styles.managedPlatformOverview}`}
              >
                <img
                  src="/assets/landing/package-sdk/aomi-build-overview-anonymized.png"
                  alt="Aomi Build overview showing projects, live deployments, recent releases, and operational navigation"
                  width={1630}
                  height={965}
                  loading="lazy"
                  decoding="async"
                />
              </figure>

              <figure
                className={`${styles.managedPlatformFrame} ${styles.managedPlatformProject}`}
              >
                <img
                  src="/assets/landing/package-sdk/aomi-build-project-home-anonymized.png"
                  alt="Aomi Build project home showing live status, environment readiness, chat access, and project management details"
                  width={1378}
                  height={1142}
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
