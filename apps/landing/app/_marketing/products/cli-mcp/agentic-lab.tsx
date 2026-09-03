"use client";

import { Check, Copy, ExternalLink, KeyRound, LogIn } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SessionTranscript } from "./agent-session";
import styles from "./agentic-surfaces.module.css";

type Surface = "skills" | "mcp" | "cli";
type McpClient = "codex" | "claude" | "cursor";

const surfaceTabs: { id: Surface; label: string }[] = [
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "cli", label: "CLI" },
];

const setupContent = {
  skills: {
    eyebrow: "Install in your coding agent",
    title: "Give the agent the workflow before the tools.",
    body: "One skills repository installs the Transact and Build instruction sets. Transact then calls the local Aomi CLI for account and signing operations.",
    code: "npx skills add aomi-labs/skills",
    facts: [
      "Installs aomi-transact",
      "Installs aomi-build",
      "Works with supported skill-aware coding agents",
    ],
  },
  cli: {
    eyebrow: "Install on your machine",
    title: "Operate Aomi directly from the terminal.",
    body: "Use the client for conversations, session recovery, transaction inspection, simulation, and wallet-controlled signing.",
    code: "npm install -g @aomi-labs/client@latest\naomi --version",
    facts: [
      "Local session control",
      "Explicit transaction inspection",
      "Signing stays on your machine",
    ],
  },
} as const;

const mcpClients: Record<
  McpClient,
  { label: string; format: string; code: string }
> = {
  codex: {
    label: "Codex",
    format: "Terminal",
    code: "codex mcp add aomi-agent --url https://chat.aomi.dev/v1/agent/mcp\ncodex mcp login aomi-agent",
  },
  claude: {
    label: "Claude Code",
    format: "Terminal",
    code: "claude mcp add --transport http aomi-agent https://chat.aomi.dev/v1/agent/mcp",
  },
  cursor: {
    label: "Cursor",
    format: "mcp.json",
    code: `{
  "mcpServers": {
    "aomi-agent": {
      "url": "https://chat.aomi.dev/v1/agent/mcp"
    }
  }
}`,
  },
};

const surfaceMatrix = [
  {
    id: "skills",
    name: "Skills",
    sub: "aomi-transact · aomi-build",
    api: "Agent API, through the CLI",
    runs: "Your machine",
    state: "Local session · ~/.aomi/",
    signing: "Local key · tx sign",
    trace: [
      "agent reads SKILL.md",
      "aomi chat --new-session",
      "tx list",
      "tx simulate",
      "tx sign",
    ],
  },
  {
    id: "mcp-agent",
    name: "MCP · agent",
    sub: "/v1/agent/mcp",
    api: "Agent API · aomi_chat",
    runs: "Aomi server",
    state: "Thread on your account",
    signing: "Hand-off → portal or CLI",
    trace: [
      "aomi_chat",
      "aomi_check …",
      "awaiting_user",
      "sign in portal / CLI",
      "aomi_check ✓",
    ],
  },
  {
    id: "mcp-pipeline",
    name: "MCP · pipeline",
    sub: "/v1/pipeline/mcp",
    api: "Pipeline API · catalog + tools",
    runs: "Aomi server",
    state: "Stateless · App passed per call",
    signing: "Hand-off → portal or CLI",
    trace: [
      "aomi_list_apps",
      "aomi_select_app",
      "aomi_list_tools",
      "aomi_describe_tool",
      "aomi_call_tool",
    ],
  },
  {
    id: "cli",
    name: "CLI",
    sub: "@aomi-labs/client",
    api: "Both · chat and tx",
    runs: "Your machine",
    state: "Local sessions · session resume",
    signing: "Local key · tx sign",
    trace: ["aomi chat", "tx list", "tx simulate", "tx sign", "session resume"],
  },
] as const;

const matrixColumns = ["Talks to", "Runs where", "State", "Signing"] as const;

export function AgenticLab() {
  const [surface, setSurface] = useState<Surface>("skills");
  const [mcpClient, setMcpClient] = useState<McpClient>("codex");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("surface");
    if (selected === "skills" || selected === "mcp" || selected === "cli") {
      setSurface(selected);
    }
  }, []);

  const activeCode = useMemo(() => {
    if (surface === "mcp") return mcpClients[mcpClient].code;
    return setupContent[surface].code;
  }, [mcpClient, surface]);

  const copyCode = async () => {
    await navigator.clipboard.writeText(activeCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <section id="setup" className={styles.setupSection}>
        <div className={styles.shell}>
          <div className={styles.labHeading}>
            <div>
              <p className={styles.eyebrow}>INTERACTIVE SETUP</p>
              <h2>Connect the surface you chose.</h2>
            </div>
            <div
              className={styles.mainTabs}
              role="tablist"
              aria-label="Setup surface"
            >
              {surfaceTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={surface === tab.id}
                  className={surface === tab.id ? styles.activeTab : ""}
                  onClick={() => {
                    setSurface(tab.id);
                    setCopied(false);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.setupPanel}>
            <div className={styles.codePanel}>
              <div className={styles.codeTopbar}>
                {surface === "mcp" ? (
                  <div
                    className={styles.clientTabs}
                    role="tablist"
                    aria-label="MCP client"
                  >
                    {(Object.keys(mcpClients) as McpClient[]).map((client) => (
                      <button
                        key={client}
                        type="button"
                        role="tab"
                        aria-selected={mcpClient === client}
                        className={
                          mcpClient === client ? styles.activeClient : ""
                        }
                        onClick={() => {
                          setMcpClient(client);
                          setCopied(false);
                        }}
                      >
                        {mcpClients[client].label}
                      </button>
                    ))}
                  </div>
                ) : surface === "cli" ? (
                  <span>Terminal</span>
                ) : null}
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={copyCode}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              {surface === "mcp" ? (
                <div className={styles.codeLabel}>
                  {mcpClients[mcpClient].format}
                </div>
              ) : null}
              <pre>
                <code>{activeCode}</code>
              </pre>
              <SessionTranscript surface={surface} />
              {surface === "skills" ? (
                <div className={styles.installedSkills}>
                  <span>
                    <Check aria-hidden />
                    aomi-transact
                  </span>
                  <span>
                    <Check aria-hidden />
                    aomi-build
                  </span>
                </div>
              ) : null}
              {surface === "mcp" ? (
                <div className={styles.oauthNotice}>
                  <KeyRound aria-hidden />
                  <span>
                    <strong>Browser OAuth opens next.</strong> Approve account
                    access there; do not paste a private key into the client.
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.setupSteps}>
            {surface === "mcp" ? (
              <>
                <p className={styles.setupLead}>
                  <span className={styles.panelEyebrow}>
                    Connect through browser OAuth
                  </span>
                  Add the hosted endpoint, then complete authorization in the
                  browser. The MCP client works inside account-owned Aomi
                  sessions.
                </p>
                <ol className={styles.stepRow}>
                  <li>
                    <span>01</span>
                    <strong>Add the endpoint</strong>
                  </li>
                  <li>
                    <span>02</span>
                    <strong>
                      <LogIn aria-hidden />
                      Authorize in browser
                    </strong>
                  </li>
                  <li>
                    <span>03</span>
                    <strong>Resume the account thread</strong>
                  </li>
                </ol>
              </>
            ) : (
              <>
                <p className={styles.setupLead}>
                  <span className={styles.panelEyebrow}>
                    {setupContent[surface].eyebrow}
                  </span>
                  {setupContent[surface].body}
                </p>
                <ol className={styles.stepRow}>
                  {setupContent[surface].facts.map((fact, index) => (
                    <li key={fact}>
                      <span>0{index + 1}</span>
                      <strong>
                        <Check aria-hidden />
                        {fact}
                      </strong>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      </section>

      <section className={styles.taskSection}>
        <div className={styles.shell}>
          <div className={styles.taskHeading}>
            <div>
              <p className={styles.eyebrow}>ONE TASK, FOUR PATHS</p>
              <h2>
                Same prompt. Different place to run, keep state, and sign.
              </h2>
            </div>
            <p className={styles.taskIntro}>
              They compose. MCP gives any client the catalog and the account
              thread; Skills give a coding agent the guided local workflow; the
              CLI is where a pending request gets simulated and signed.
            </p>
          </div>

          <div className={styles.matrix}>
            <div className={`${styles.matrixRow} ${styles.matrixHead}`}>
              <span>Surface</span>
              {matrixColumns.map((column) => (
                <span key={column}>{column}</span>
              ))}
            </div>
            {surfaceMatrix.map((row) => (
              <div key={row.id} className={styles.matrixRow}>
                <div className={styles.matrixName}>
                  <strong>{row.name}</strong>
                  <span>{row.sub}</span>
                </div>
                <span>{row.api}</span>
                <span>{row.runs}</span>
                <span>{row.state}</span>
                <span>{row.signing}</span>
                <ol
                  className={styles.matrixTrace}
                  aria-label={`${row.name} trace`}
                >
                  {row.trace.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <a
            className={styles.taskDocs}
            href="https://aomi.dev/docs/guides/mcp"
            target="_blank"
            rel="noreferrer"
          >
            Read the execution handoff guide <ExternalLink aria-hidden />
          </a>
        </div>
      </section>
    </>
  );
}
