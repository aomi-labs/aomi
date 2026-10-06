import type { Session } from "@aomi-labs/client";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { Abi } from "viem";

import { ActionReview } from "./ActionReview";
import { CommitReview } from "./CommitReview";
import type { InjectedWallet } from "./injected-wallet";

export interface ChatProps {
  session: Session;
  wallet: InjectedWallet;
  allowedTargets: readonly string[];
  abi: Abi;
}

export function Chat({ session, wallet, allowedTargets, abi }: ChatProps) {
  // The Session is an external store: subscribe once and re-render on every
  // streamed message, Action, or turn-state change.
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string>();

  // Durable messages, then the in-progress (streaming) reply for this turn.
  const committedKeys = new Set(snapshot.messages.map((m) => m.message_key));
  const committedTurns = new Set(snapshot.messages.map((m) => m.turn_id));
  const transcript = [
    ...snapshot.messages,
    ...(snapshot.liveMessages ?? []).filter(
      (live) =>
        !committedKeys.has(live.message_key) &&
        !committedTurns.has(live.turn_id),
    ),
  ].filter(
    (message) =>
      (message.sender === "user" || message.sender === "agent") &&
      !message.tool_result &&
      message.content.trim(),
  );
  const busy =
    snapshot.isSubmitting ||
    snapshot.turnState === "processing" ||
    snapshot.actions.some((action) => action.state === "pending");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt("");
    setError(undefined);
    // send() resolves when the turn finishes. While the turn waits on an
    // Action, it stays open until the user approves or rejects below.
    session
      .send(text)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  };

  return (
    <section className="chat">
      <ol className="transcript">
        {transcript.map((message) => (
          <li key={message.event_id} className={message.sender}>
            {message.content}
          </li>
        ))}
        {snapshot.pendingUserMessage && (
          <li className="user">{snapshot.pendingUserMessage}</li>
        )}
        {snapshot.turnState === "processing" && (
          <li className="muted">Aomi is working…</li>
        )}
      </ol>

      {/* Actions are the agent's requests for a wallet decision. Resolved
          ones stay listed with their outcome. */}
      {snapshot.actions.map((action) => (
        <ActionReview
          key={`${action.id}:${action.revision}`}
          session={session}
          action={action}
          wallet={wallet}
          allowedTargets={allowedTargets}
          abi={abi}
        />
      ))}

      {snapshot.commits.map((commit) => (
        <CommitReview
          key={commit.commit_id}
          session={session}
          commit={commit}
          wallet={wallet}
          allowedTargets={allowedTargets}
          abi={abi}
        />
      ))}

      {error && <p className="error">{error}</p>}

      <form onSubmit={submit}>
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="e.g. Send 0.001 ETH to vitalik.eth"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !prompt.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
