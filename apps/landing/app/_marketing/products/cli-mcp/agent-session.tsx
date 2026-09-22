"use client";

import { useEffect, useState } from "react";
import { Bot, Network, Pause, Play, RotateCcw, Terminal } from "lucide-react";
import styles from "./agentic-surfaces.module.css";

export type Surface = "skills" | "mcp" | "cli";

type Line = {
  kind: "user" | "agent" | "cmd" | "out" | "ok" | "call" | "ret" | "halt";
  text: string;
  delay?: number;
};

type Session = {
  id: Surface;
  label: string;
  client: string;
  icon: typeof Bot;
  owner: string;
  lines: readonly Line[];
  stages: readonly [string, string, string];
};

export const SESSIONS: readonly Session[] = [
  {
    id: "skills",
    label: "Agent Skills",
    client: "Claude Code",
    icon: Bot,
    owner: "Coding agent + local CLI",
    stages: ["Build", "Simulate", "Awaiting signature"],
    lines: [
      {
        kind: "user",
        text: "Move 2,000 USDC into the best yield on Base.",
      },
      { kind: "agent", text: "Reading skill aomi-transact", delay: 700 },
      {
        kind: "cmd",
        text: 'aomi chat "supply 2,000 USDC to the best yield on Base" --new-session --chain 8453',
      },
      {
        kind: "out",
        text: "Morpho Blue 4.62% net · Aave v3 4.18% · Compound v3 3.30%",
        delay: 900,
      },
      {
        kind: "out",
        text: "pending act_91a · 2 EVM transactions · supply Morpho Blue",
      },
      { kind: "cmd", text: "aomi tx simulate act_91a", delay: 600 },
      {
        kind: "ok",
        text: "fork ok · gas 0.0007 ETH · drain-vector guard passed",
        delay: 1100,
      },
      {
        kind: "halt",
        text: "Stopped at approval. Run aomi tx sign act_91a when ready.",
        delay: 500,
      },
    ],
  },
  {
    id: "mcp",
    label: "Hosted MCP",
    client: "Codex",
    icon: Network,
    owner: "Hosted Aomi session + your wallet",
    stages: ["Build", "Simulate", "Awaiting signature"],
    lines: [
      {
        kind: "user",
        text: "Ask Aomi for my USDC balance on Base, then move it into the best yield.",
      },
      {
        kind: "call",
        text: 'aomi_chat { "chain_context": { "family": "evm", "chain_id": 8453 } }',
        delay: 700,
      },
      { kind: "ret", text: "cursor c_7f2… · status processing", delay: 700 },
      { kind: "call", text: "aomi_check", delay: 600 },
      {
        kind: "ret",
        text: "balance 2,000 USDC · selected Morpho Blue 4.62% net",
        delay: 900,
      },
      { kind: "call", text: "aomi_check", delay: 600 },
      {
        kind: "ret",
        text: "status awaiting_action · act_91a supply 2,000 USDC → Morpho Blue · simulated",
        delay: 900,
      },
      {
        kind: "halt",
        text: "Approve in Portal or `aomi tx sign act_91a`. No key passes through MCP.",
        delay: 500,
      },
    ],
  },
  {
    id: "cli",
    label: "Client CLI",
    client: "Terminal",
    icon: Terminal,
    owner: "Operator + local signer",
    stages: ["Build", "Simulate", "Signed & broadcast"],
    lines: [
      {
        kind: "cmd",
        text: 'aomi chat "supply 2,000 USDC to the best yield on Base" --new-session --chain 8453',
      },
      {
        kind: "out",
        text: "selected Morpho Blue 4.62% net · 2 transactions queued",
        delay: 900,
      },
      { kind: "cmd", text: "aomi tx list", delay: 500 },
      {
        kind: "out",
        text: "act_91a  supply Morpho · 2 transactions  pending  base",
        delay: 500,
      },
      { kind: "cmd", text: "aomi tx simulate act_91a", delay: 500 },
      {
        kind: "ok",
        text: "fork ok · gas 0.0007 ETH · batch_status ready",
        delay: 1000,
      },
      { kind: "cmd", text: "aomi tx sign act_91a", delay: 600 },
      {
        kind: "ok",
        text: "signed locally · broadcast · 0x4e…c1 confirmed",
        delay: 1200,
      },
    ],
  },
] as const;

const PROMPTS: Record<Line["kind"], string> = {
  user: "›",
  agent: "◆",
  cmd: "$",
  out: " ",
  ok: "✓",
  call: "→",
  ret: "←",
  halt: "⏸",
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Animated transcript of the selected surface in use. Rendered inside the
 * Interactive Setup terminal; the lab owns surface selection.
 */
export function SessionTranscript({ surface }: { surface: Surface }) {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [run, setRun] = useState(0);
  const reduced = useReducedMotion();

  const session = SESSIONS.find((item) => item.id === surface) ?? SESSIONS[0];
  const total = session.lines.length;
  const done = shown >= total;

  useEffect(() => {
    setShown(0);
    setPlaying(true);
  }, [surface]);

  useEffect(() => {
    if (reduced) {
      setShown(total);
      return;
    }
    if (!playing || done) return;
    const delay = session.lines[shown]?.delay ?? 420;
    const timer = window.setTimeout(() => setShown((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [shown, playing, done, reduced, session, total, run]);

  const stageIndex = done ? 3 : Math.min(2, Math.floor((shown / total) * 3));

  return (
    <div className={styles.transcript} aria-label="Session transcript fixture">
      <div className={styles.transcriptTop}>
        <span>
          SESSION · {session.client} · {session.owner}
        </span>
        <div className={styles.transcriptControls}>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </button>
          <button
            type="button"
            aria-label="Replay"
            onClick={() => {
              setShown(0);
              setPlaying(true);
              setRun((n) => n + 1);
            }}
          >
            <RotateCcw aria-hidden />
          </button>
        </div>
      </div>

      <ol className={styles.transcriptLines} aria-live="polite">
        {session.lines.slice(0, shown).map((line, index) => (
          <li
            key={`${surface}-${run}-${index}`}
            className={styles[`tl_${line.kind}`]}
          >
            <span aria-hidden>{PROMPTS[line.kind]}</span>
            <code>{line.text}</code>
          </li>
        ))}
        {!done && !reduced ? (
          <li className={styles.tl_cursor} aria-hidden>
            <span> </span>
            <code>
              <i />
            </code>
          </li>
        ) : null}
      </ol>

      <div className={styles.transcriptStages}>
        {session.stages.map((stage, index) => (
          <span
            key={stage}
            className={
              index < stageIndex
                ? styles.stageDone
                : index === stageIndex
                  ? styles.stageLive
                  : ""
            }
          >
            <i aria-hidden />
            {stage}
          </span>
        ))}
        <em>Deterministic fixture · no live chat, wallet, or chain call</em>
      </div>
    </div>
  );
}
