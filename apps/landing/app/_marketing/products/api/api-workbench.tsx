"use client";

import { Check, ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import styles from "./rest-api.module.css";

type Surface = "agent" | "pipeline";

const examples = {
  agent: {
    label: "Agent API",
    version: "v1",
    endpoint: "POST /v1/agent/chat",
    request: `curl https://chat.aomi.dev/v1/agent/chat \\
  -H "Authorization: Bearer $AOMI_TOKEN" \\
  -H "Idempotency-Key: 7c1e…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Swap 0.5 ETH to USDC on Base",
    "app": "aomi",
    "userState": {
      "connection": { "is_connected": true },
      "evm": {
        "address": "0xAb5…",
        "chain_id": 8453
      }
    }
  }'`,
    response: `{
  "session_id": "sess_…",
  "cursor": "cur_…",
  "events": [{
    "type": "message",
    "event_id": "evt_…",
    "sequence": 1,
    "turn_id": "turn_…",
    "occurred_at": 1788174000,
    "sender": "user",
    "content": "Swap 0.5 ETH to USDC on Base"
  }],
  "has_more": false
}`,
    status: "event page",
    title: "Ordered events with a durable cursor",
    detail: "Messages, activity, turn state, and Actions share one event log",
  },
  pipeline: {
    label: "Pipeline API",
    version: "v1",
    endpoint: "POST /v1/pipeline/evm/stage",
    request: `curl https://chat.aomi.dev/v1/pipeline/evm/stage \\
  -H "Authorization: Bearer $AOMI_TOKEN" \\
  -H "Idempotency-Key: 9a40…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "actions": [{
      "chainId": 8453,
      "description": "Supply USDC",
      "calls": [{
        "to": "0x…",
        "data": "0x…",
        "value": "0"
      }]
    }]
  }'`,
    response: `{
  "version": 1,
  "status": "staged",
  "actions": [{
    "id": "action_0",
    "chainFamily": "evm",
    "kind": "calls",
    "chainId": 8453,
    "calls": [{
      "to": "0x…",
      "data": "0x…",
      "value": "0x0"
    }]
  }],
  "digest": "sha256:…"
}`,
    status: "staged",
    title: "Portable staged EVM Build",
    detail: "Exact ordered calls and a stable digest",
  },
} as const;

export function ApiWorkbench() {
  const [surface, setSurface] = useState<Surface>("agent");
  const example = examples[surface];

  return (
    <div className={styles.workbench}>
      <div className={styles.workbenchTopline}>
        <div
          className={styles.surfaceTabs}
          role="tablist"
          aria-label="API path"
        >
          {(Object.keys(examples) as Surface[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={surface === key}
              className={surface === key ? styles.surfaceTabActive : ""}
              onClick={() => setSurface(key)}
            >
              {examples[key].label}
              <span>{examples[key].version}</span>
            </button>
          ))}
        </div>
        <span className={styles.liveContract}>
          <i aria-hidden /> JSON REST
        </span>
      </div>

      <div className={styles.workbenchBody}>
        <div className={styles.requestPanel}>
          <div className={styles.panelLabel}>
            <span>{example.endpoint}</span>
            <span>curl request</span>
          </div>
          <pre key={`${surface}-request`}>
            <code>{example.request}</code>
          </pre>
        </div>

        <div className={styles.responseCodePanel}>
          <div className={styles.panelLabel}>
            <span>200 / application&#47;json</span>
            <span>response</span>
          </div>
          <pre key={`${surface}-response`}>
            <code>{example.response}</code>
          </pre>
        </div>
      </div>

      <div className={styles.actionComposition}>
        <div className={styles.responsePanel}>
          <div className={styles.actionCard} key={`${surface}-action`}>
            <div className={styles.responseStatus}>
              <span>
                <Check aria-hidden /> {example.status}
              </span>
              <span>Typed v1 response · HTTP 200</span>
            </div>
            <div className={styles.actionCardTop}>
              <span>
                {surface === "agent" ? "EVENT PAGE" : "PIPELINE BUILD"}
              </span>
              <ShieldCheck aria-hidden />
            </div>
            <h3>{example.title}</h3>
            <p>{example.detail}</p>
            <div className={styles.actionStep}>
              <span>01</span>
              <div>
                <strong>
                  {surface === "agent"
                    ? "Continue from the returned cursor"
                    : "Simulate the staged Build"}
                </strong>
                <small>
                  {surface === "agent"
                    ? "Poll the same session for later events and pending Actions."
                    : "POST /simulate with { build }; commit accepts the returned simulated Build."}
                </small>
              </div>
              <ChevronRight aria-hidden />
            </div>
            <div className={styles.responseFacts}>
              <span>
                {surface === "agent" ? "ordered events" : "portable build"}
              </span>
              <span>
                {surface === "agent" ? "durable cursor" : "exact calls"}
              </span>
              <span>
                {surface === "agent" ? "actions recoverable" : "digest bound"}
              </span>
            </div>
          </div>
        </div>

        <ol className={styles.actionFlow} aria-label="Action lifecycle">
          <li>
            <span>01</span>
            <strong>Request</strong>
            <small>Intent or exact operation enters the API</small>
          </li>
          <li>
            <span>02</span>
            <strong>Build</strong>
            <small>Transactions and simulation form a portable Build</small>
          </li>
          <li>
            <span>03</span>
            <strong>Sign</strong>
            <small>Your wallet approves the exact payload</small>
          </li>
          <li>
            <span>04</span>
            <strong>Resume</strong>
            <small>The verified result continues the workflow</small>
          </li>
        </ol>
      </div>
    </div>
  );
}
