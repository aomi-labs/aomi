import { Link } from "@tanstack/react-router";

export default function PrivacyPolicy() {
  return (
    <div className="bg-background h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link
          to="/"
          className="text-muted-foreground hover:text-foreground mb-8 inline-flex items-center text-sm"
        >
          ← Back to Aomi
        </Link>

        <h1 className="mb-2 text-4xl font-bold tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-muted-foreground mb-12 text-sm">
          Last Updated: March 16, 2026
        </p>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">The Short Version</h2>
            <p className="text-muted-foreground">
              We collect what we need to run the service (your wallet address,
              messages, transaction data). We use Google Analytics to understand
              how people use our site. We don&apos;t sell your data. You can ask
              us to delete your data anytime.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">What We Collect</h2>
            <p className="mb-3 font-medium">When you use Aomi:</p>
            <ul className="text-muted-foreground mb-4 list-disc space-y-1 pl-6">
              <li>
                Your public wallet address (required to execute transactions)
              </li>
              <li>Messages you send to our AI assistant</li>
              <li>
                Transaction records (which are already public on the blockchain)
              </li>
              <li>Optional username if you choose to set one</li>
            </ul>
            <p className="mb-3 font-medium">Automatically:</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-6">
              <li>
                Basic analytics via Google Analytics (pages visited, device
                type, general location)
              </li>
              <li>Session information (when you started, last activity)</li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">How We Use It</h2>
            <ul className="text-muted-foreground mb-4 list-disc space-y-1 pl-6">
              <li>
                To provide the service and execute transactions you request
              </li>
              <li>To maintain conversation context within your session</li>
              <li>To understand how people use the product and improve it</li>
              <li>To identify and fix technical issues</li>
            </ul>
            <p className="text-muted-foreground">
              We <strong className="text-foreground">don&apos;t</strong> sell
              your data, use it for ad targeting, or share your conversations
              with other users.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Cookies</h2>
            <p className="text-muted-foreground">
              We use Google Analytics, which sets cookies to track site usage.
              You can opt out using the{" "}
              <a
                href="https://tools.google.com/dlpage/gaoptout"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline hover:no-underline"
              >
                Google Analytics Opt-out Add-on
              </a>{" "}
              or your browser&apos;s privacy settings.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Third-Party Services</h2>
            <p className="text-muted-foreground mb-3">
              We use these services that may process your data:
            </p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-6">
              <li>
                <strong className="text-foreground">Google Analytics</strong> —
                website analytics
              </li>
              <li>
                <strong className="text-foreground">Vercel</strong> — hosting
              </li>
              <li>
                <strong className="text-foreground">Anthropic / OpenAI</strong>{" "}
                — AI models
              </li>
              <li>
                <strong className="text-foreground">Alchemy</strong> —
                blockchain data
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">
              Your Wallet, Your Keys
            </h2>
            <p className="text-muted-foreground">
              We can see your public wallet address and transaction history
              (which is public anyway). We{" "}
              <strong className="text-foreground">cannot</strong> access your
              private keys, seed phrase, or funds. Every transaction requires
              your signature — we&apos;re just the interface.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Your Rights</h2>
            <p className="text-muted-foreground mb-3">You can:</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-6">
              <li>Request a copy of your data</li>
              <li>Ask us to correct inaccurate data</li>
              <li>Ask us to delete your data</li>
              <li>Opt out of analytics tracking</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              This applies whether you&apos;re in the EU, California, or
              anywhere else.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Data Retention</h2>
            <p className="text-muted-foreground">
              We keep your data as long as needed to provide the service. You
              can request deletion anytime and we&apos;ll remove it within 30
              days, unless we&apos;re legally required to keep it.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Security</h2>
            <p className="text-muted-foreground">
              We use HTTPS, secure databases, and access controls. No system is
              perfect — if you find a vulnerability, please let us know.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Changes</h2>
            <p className="text-muted-foreground">
              If we make significant changes to this policy, we&apos;ll update
              the date above and post a notice on the site.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="mb-4 text-xl font-semibold">Contact</h2>
            <p className="text-muted-foreground">
              Questions about privacy? Email us at{" "}
              <a
                href="mailto:business@foameo.ai"
                className="text-foreground underline hover:no-underline"
              >
                business@foameo.ai
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
