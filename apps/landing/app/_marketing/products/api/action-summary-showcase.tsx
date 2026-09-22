"use client";

import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import styles from "./rest-api.module.css";

type SourceKey = "agent" | "pipeline" | "recovery";

type FieldKey =
  | "id"
  | "revision"
  | "state"
  | "request"
  | "result"
  | "status"
  | "digest"
  | "requests";

type ContractKey = "action" | "commit";

type SheetStep = {
  label: string;
  sub?: string;
  amount?: string;
  direction?: "out" | "in";
};

type SheetExample = {
  tabLabel: string;
  tabTag: string;
  sourceExpr: string;
  sourceNote: string;
  title: string;
  steps: SheetStep[];
  cost: string;
  warning?: string;
  pendingHint?: string;
  contract: ContractKey;
  usedFields: FieldKey[];
  requestLabel: string;
  request: string[];
};

const sheetExamples: Record<SourceKey, SheetExample> = {
  agent: {
    tabLabel: "Agent API",
    tabTag: "v1",
    sourceExpr: "event.request",
    sourceNote: "Action event from a chat turn",
    title: "Swap 0.5 ETH for ~1,240 USDC",
    steps: [
      { label: "Wrap 0.5 ETH", amount: "−0.5 ETH", direction: "out" },
      {
        label: "Swap via Uniswap v3",
        sub: "Simulated · guards passed",
        amount: "+1,240.18 USDC",
        direction: "in",
      },
    ],
    cost: "Gas: you pay ~$1.20",
    warning: "Price impact 2.3%",
    contract: "action",
    usedFields: ["id", "revision", "state", "request"],
    requestLabel: "one call · chat",
    request: [
      "POST /v1/agent/chat",
      "Authorization: Bearer $AOMI_TOKEN",
      "Idempotency-Key: 7c1e…",
      "",
      '{ "message": "Swap 0.5 ETH to USDC on Base",',
      '  "mode": "direct",',
      '  "app": "default",',
      '  "userState": { "evm": { "address": "0xAb5…", "chain_id": 8453 } } }',
    ],
  },
  pipeline: {
    tabLabel: "Pipeline API",
    tabTag: "Build v2",
    sourceExpr: "commit.requests[0]",
    sourceNote: "stateless request; no Action ID",
    title: "Rotate 2,000 USDC into Morpho",
    steps: [
      {
        label: "Withdraw from Aave v3",
        sub: "2,000 aUSDC redeemed",
        amount: "+2,000 USDC",
        direction: "in",
      },
      {
        label: "Supply to Morpho Blue",
        sub: "Simulation evidence attached",
        amount: "−2,000 USDC",
        direction: "out",
      },
    ],
    cost: "Network fee shown before approval",
    contract: "commit",
    usedFields: ["status", "digest", "requests"],
    requestLabel: "portable build · stage, simulate, commit",
    request: [
      "POST /v1/pipeline/evm/stage",
      '{ "actions": [{ "to": "0x…", "description": "Supply USDC",',
      '  "data": { "signature": "", "args": [], "raw": "0x…" },',
      '  "chain_id": 8453, "value": "0" }] }',
      "",
      "POST /v1/pipeline/evm/simulate",
      '{ "build": { "version": 2, "status": "staged", … } }',
      "",
      "POST /v1/pipeline/evm/commit",
      '{ "build": { "version": 2, "status": "simulated", … } }',
    ],
  },
  recovery: {
    tabLabel: "Agent recovery",
    tabTag: "recovery",
    sourceExpr: "action.request",
    sourceNote: "latest Action revision, any device",
    title: "Transfer 50,000 USDC to treasury ops",
    steps: [
      {
        label: "Transfer to ops.aomi.eth",
        sub: "Base · simulated request",
        amount: "−50,000 USDC",
        direction: "out",
      },
    ],
    cost: "Network fee shown before approval",
    pendingHint:
      "The Action remains pending until the host reports a supported result.",
    contract: "action",
    usedFields: ["id", "revision", "state", "request"],
    requestLabel: "recover a pending Action",
    request: [
      "GET /v1/agent/chat/{session}?cursor=cur_…",
      "// unresolved actions come back in every delta, from any device",
      '// report only a supported result: "submitted", "signed", or "rejected"',
    ],
  },
};

type CodeLine = { field?: FieldKey; content: ReactNode };

function interfaceLines(contract: ContractKey): CodeLine[] {
  const kw = styles.showcaseKw;
  const ty = styles.showcaseTy;
  const cm = styles.showcaseCm;

  if (contract === "commit") {
    return [
      {
        content: (
          <>
            <span className={kw}>interface</span>{" "}
            <span className={ty}>EvmCommitResult</span> {"{"}
          </>
        ),
      },
      { field: "status", content: '  status: "committed"' },
      { field: "digest", content: "  digest: string" },
      { field: "result", content: "  result: unknown" },
      {
        field: "requests",
        content: (
          <>
            {"  requests: "}
            <span className={ty}>ActionRequest</span>[]
            {"  "}
            <span className={cm}>{"// stateless signer requests"}</span>
          </>
        ),
      },
      { content: "}" },
    ];
  }

  return [
    {
      content: (
        <>
          <span className={kw}>interface</span>{" "}
          <span className={ty}>Action</span> {"{"}
        </>
      ),
    },
    { content: '  type: "action"' },
    { content: "  event_id: string" },
    { content: "  sequence: number" },
    { content: "  turn_id: string | null" },
    { content: "  occurred_at: number" },
    {
      field: "id",
      content: (
        <>
          {"  id: "}
          <span className={ty}>string</span>
        </>
      ),
    },
    {
      field: "revision",
      content: (
        <>
          {"  revision: "}
          <span className={ty}>number</span>
        </>
      ),
    },
    {
      field: "state",
      content: (
        <>
          {"  state: "}
          <span className={ty}>Action</span>[
          <span className={cm}>{'"state"'}</span>]
        </>
      ),
    },
    {
      field: "request",
      content: (
        <>
          {"  request: "}
          <span className={ty}>ActionRequest</span>
          {"  "}
          <span className={cm}>{"// execute_evm | execute_svm | sign"}</span>
        </>
      ),
    },
    {
      field: "result",
      content: (
        <>
          {"  result?: "}
          <span className={ty}>ActionResult</span> <span className={kw}>|</span>{" "}
          <span className={kw}>null</span>
        </>
      ),
    },
    { content: "  created_at: number" },
    { content: "  expires_at: number | null" },
    { content: "}" },
  ];
}

const HTTP_TOKEN =
  /("(?:\\.|[^"\\])*"|\/\/[^\n]*|\b(?:POST|GET|PATCH|DELETE)\b|\btrue\b|\bfalse\b|\bnull\b|\b\d[\d]*\b)/g;

function highlightHttp(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of line.matchAll(HTTP_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(line.slice(cursor, index));

    const token = match[0];
    let className = styles.showcaseKw;
    if (token.startsWith("//")) className = styles.showcaseCm;
    else if (token.startsWith('"')) className = styles.showcaseStr;
    else if (/^(?:POST|GET|PATCH|DELETE)$/.test(token)) {
      className = styles.showcaseMethod;
    }

    parts.push(
      <span key={`${index}-${token}`} className={className}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }

  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts;
}

function RequestCode({ lines }: { lines: string[] }) {
  return (
    <pre>
      <code>
        {lines.map((line, index) => (
          <span key={index} className={styles.showcaseLine}>
            {line.length > 0 ? highlightHttp(line) : "\u00a0"}
          </span>
        ))}
      </code>
    </pre>
  );
}

function InterfaceCode({
  contract,
  used,
}: {
  contract: ContractKey;
  used: FieldKey[];
}) {
  const lines = interfaceLines(contract);
  return (
    <pre>
      <code>
        {lines.map((line, index) => {
          const dim = line.field !== undefined && !used.includes(line.field);
          return (
            <span
              key={index}
              className={`${styles.showcaseLine} ${dim ? styles.showcaseLineDim : ""}`}
            >
              {line.content}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function ActionSummaryShowcase() {
  const [source, setSource] = useState<SourceKey>("agent");
  const example = sheetExamples[source];

  return (
    <div className={styles.showcase}>
      <div className={styles.showcaseTopline}>
        <div
          className={styles.showcaseTabs}
          role="tablist"
          aria-label="Where the Action came from"
        >
          {(Object.keys(sheetExamples) as SourceKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={source === key}
              className={source === key ? styles.showcaseTabActive : ""}
              onClick={() => setSource(key)}
            >
              {sheetExamples[key].tabLabel}
              <span>{sheetExamples[key].tabTag}</span>
            </button>
          ))}
        </div>
        <span className={styles.showcaseChip}>
          <ShieldCheck aria-hidden /> one request renderer · two lifecycles
        </span>
      </div>

      <div className={styles.showcaseRequest} key={`${source}-req`}>
        <div className={styles.showcaseTypeLabel}>
          <span>{example.requestLabel}</span>
          <span>raw http · illustrative wire shape</span>
        </div>
        <RequestCode lines={example.request} />
      </div>

      <div className={styles.showcaseBody}>
        <div className={styles.showcaseType}>
          <div className={styles.showcaseTypeLabel}>
            <span>
              {example.contract === "action" ? "Action" : "EvmCommitResult"}
            </span>
            <span>current @aomi-labs/client source contract</span>
          </div>
          <InterfaceCode
            contract={example.contract}
            used={example.usedFields}
          />
          <p className={styles.showcaseTypeFoot}>
            <span>filled by this example</span>
            {(example.contract === "action"
              ? (["id", "revision", "state", "request", "result"] as const)
              : (["status", "digest", "result", "requests"] as const)
            ).map((field) => (
              <em
                key={field}
                data-dim={example.usedFields.includes(field) ? undefined : true}
              >
                {field}
              </em>
            ))}
          </p>
        </div>

        <div className={styles.showcaseSheetCol}>
          <p className={styles.showcaseSource} key={`${source}-src`}>
            <code>{example.sourceExpr}</code>
            <span>{"// " + example.sourceNote}</span>
          </p>

          <article
            className={styles.confirmSheet}
            key={source}
            aria-label={`Confirm sheet rendered from the ${example.tabLabel} action`}
          >
            <h3>{example.title}</h3>
            <div className={styles.confirmSteps}>
              {example.steps.map((step) => (
                <div key={step.label} className={styles.confirmStep}>
                  <span className={styles.confirmStepLabel}>
                    {step.label}
                    {step.sub ? <small>{step.sub}</small> : null}
                  </span>
                  {step.amount ? (
                    <span
                      className={
                        step.direction === "in"
                          ? styles.confirmAmtIn
                          : styles.confirmAmtOut
                      }
                    >
                      {step.amount}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className={styles.confirmMeta}>
              <span>{example.cost}</span>
              {example.warning ? (
                <span className={styles.confirmWarning}>
                  &#9888; {example.warning}
                </span>
              ) : null}
            </div>
            {example.pendingHint ? (
              <div className={styles.confirmDeferred}>
                <i aria-hidden /> {example.pendingHint}
              </div>
            ) : (
              <div className={styles.confirmButtons}>
                <span className={styles.confirmReject}>Reject</span>
                <span className={styles.confirmApprove}>Approve</span>
              </div>
            )}
          </article>

          <p className={styles.showcaseFoot}>
            approval view derived from ActionRequest and simulation evidence
          </p>
        </div>
      </div>

      <p className={styles.showcaseCaption}>
        Both APIs use the ActionRequest union, so the host can render the exact
        transactions or signing payload with simulation evidence. Agent Actions
        remain revisioned and recoverable; Pipeline commit requests are
        stateless and carry no Action ID.
      </p>
    </div>
  );
}
