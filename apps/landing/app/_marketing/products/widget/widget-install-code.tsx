"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "./widget-product.module.css";

const wallets = {
  "Browser wallet": {
    description:
      "Browser mode authenticates an existing EOA. No Para or Privy provider import required.",
    provider: null,
    environment: null,
  },
  Para: {
    description:
      "Importing the Para entry point registers Para authentication and its wallet signer.",
    provider: "para",
    environment: "PROD",
  },
  Privy: {
    description:
      "Importing the Privy entry point registers Privy authentication and its wallet signer.",
    provider: "privy",
    environment: "production",
  },
} as const;

type Wallet = keyof typeof wallets;
type Mode = "UI" | "Terminal";
type TerminalTab = "CLI" | "MCP";

function uiSnippet(wallet: Wallet) {
  const config = wallets[wallet];
  const providerImport = config.provider
    ? `\nimport "@aomi-labs/widget-lib/providers/${config.provider}";`
    : "";
  const auth = config.provider
    ? `auth={{\n        kind: "embedded_wallet",\n        provider: "${config.provider}",\n        environment: "${config.environment}",\n      }}`
    : 'auth={{ kind: "browser_wallet" }}';

  return `import { AomiWidget } from "@aomi-labs/widget-lib";${providerImport}
import "@aomi-labs/widget-lib/styles.css";

export default function AssistantPage() {
  return (
    <AomiWidget
      applicationId={process.env.AOMI_APPLICATION_ID!}
      apiUrl={process.env.AOMI_API_URL!}
      ${auth}
      height="calc(100dvh - 32px)"
    />
  );
}`;
}

const terminalSnippets = {
  CLI: `# Sign in with an embedded provider in your browser
aomi account login --provider privy

# Or authenticate with the configured EVM wallet
aomi account login --wallet

aomi wallet current --json`,
  MCP: `npx skills add aomi-labs/skills
codex mcp add aomi-agent --url https://chat.aomi.dev/v1/agent/mcp
codex mcp login aomi-agent

# OAuth binds the session to your Aomi account.
# Wallets remain account-scoped.`,
} as const;

export function WidgetInstallCode() {
  const [wallet, setWallet] = useState<Wallet>("Browser wallet");
  const [mode, setMode] = useState<Mode>("UI");
  const [terminalTab, setTerminalTab] = useState<TerminalTab>("CLI");
  const [copied, setCopied] = useState(false);
  const value = useMemo(
    () => (mode === "UI" ? uiSnippet(wallet) : terminalSnippets[terminalTab]),
    [mode, terminalTab, wallet],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={styles.installCodeDemo}>
      <div className={styles.installCodeTabs}>
        <div
          role="tablist"
          aria-label={mode === "UI" ? "Wallet" : "Terminal surface"}
        >
          {mode === "UI"
            ? (Object.keys(wallets) as Wallet[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={wallet === item}
                  onClick={() => setWallet(item)}
                >
                  {item}
                </button>
              ))
            : (Object.keys(terminalSnippets) as TerminalTab[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={terminalTab === item}
                  onClick={() => setTerminalTab(item)}
                >
                  {item}
                </button>
              ))}
        </div>
        <div
          className={styles.installModeSwitch}
          role="tablist"
          aria-label="Code mode"
        >
          {(["UI", "Terminal"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.installCodeDescription}>
        {mode === "UI"
          ? wallets[wallet].description
          : terminalTab === "CLI"
            ? "Bring a key, a wallet signature, or just a provider login. All three work."
            : "OAuth binds the session to your Aomi account, while wallets remain account-scoped."}
      </p>

      <div className={styles.installCodeSurface}>
        <button
          type="button"
          className={styles.installCodeCopy}
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </button>
        {mode === "UI" ? (
          <UiCode wallet={wallet} />
        ) : (
          <TerminalCode tab={terminalTab} />
        )}
      </div>
    </div>
  );
}

function UiCode({ wallet }: { wallet: Wallet }) {
  const config = wallets[wallet];

  return (
    <pre
      className={styles.installSyntax}
      aria-label={`${wallet} React example`}
    >
      <code>
        <span>
          <i>import</i> {"{ AomiWidget }"} <i>from</i>{" "}
          <em>{'"@aomi-labs/widget-lib"'}</em>;
        </span>
        {config.provider ? (
          <span className={styles.installSyntaxFocus}>
            <i>import</i>{" "}
            <em>{`"@aomi-labs/widget-lib/providers/${config.provider}"`}</em>;
          </span>
        ) : null}
        <span>
          <i>import</i> <em>{'"@aomi-labs/widget-lib/styles.css"'}</em>;
        </span>
        <span>&nbsp;</span>
        <span>
          <i>export default function</i> <b>AssistantPage</b>() {"{"}
        </span>
        <span>
          <i>&nbsp;&nbsp;return</i> (
        </span>
        <span>
          &nbsp;&nbsp;&nbsp;&nbsp;&lt;<em>AomiWidget</em>
        </span>
        <span>
          <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;applicationId</u>=
          {"{process.env.AOMI_APPLICATION_ID!}"}
        </span>
        <span>
          <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;apiUrl</u>=
          {"{process.env.AOMI_API_URL!}"}
        </span>
        {config.provider ? (
          <>
            <span className={styles.installSyntaxFocus}>
              <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;auth</u>={"{{"}
            </span>
            <span className={styles.installSyntaxFocus}>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;kind:{" "}
              <em>{'"embedded_wallet"'}</em>,
            </span>
            <span className={styles.installSyntaxFocus}>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;provider:{" "}
              <em>{`"${config.provider}"`}</em>,
            </span>
            <span className={styles.installSyntaxFocus}>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;environment:{" "}
              <em>{`"${config.environment}"`}</em>,
            </span>
            <span className={styles.installSyntaxFocus}>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{"}}"}
            </span>
          </>
        ) : (
          <span className={styles.installSyntaxFocus}>
            <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;auth</u>={"{{ kind: "}
            <em>{'"browser_wallet"'}</em>
            {" }}"}
          </span>
        )}
        <span>
          <u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;height</u>=
          <em>{'"calc(100dvh - 32px)"'}</em>
        </span>
        <span>&nbsp;&nbsp;&nbsp;&nbsp;/&gt;</span>
        <span>&nbsp;&nbsp;);</span>
        <span>{"}"}</span>
      </code>
    </pre>
  );
}

function TerminalCode({ tab }: { tab: TerminalTab }) {
  return (
    <pre className={`${styles.installSyntax} ${styles.installTerminalSyntax}`}>
      <code>
        {terminalSnippets[tab].split("\n").map((line, index) => (
          <span
            key={`${line}-${index}`}
            className={line.startsWith("#") ? styles.installSyntaxComment : ""}
          >
            {line || "\u00a0"}
          </span>
        ))}
      </code>
    </pre>
  );
}
