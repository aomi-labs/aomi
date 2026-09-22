import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import { Session, type CommitView } from "@aomi-labs/client";

describe("commit capability registration", () => {
  it("rerenders only when wallet capability availability changes", async () => {
    const commit: CommitView = {
      version: 1,
      commit_id: "commit-1",
      thread_id: "thread-1",
      stage_id: "svm:1",
      chain_family: "svm",
      chain_ref: "devnet",
      signer: "payer",
      broadcaster: "wallet",
      state: "needs_signature",
      transaction_id: null,
      failure_code: null,
      batch: null,
      review: null,
      wallet_attempt: null,
      action: {
        kind: "sign",
        payload: {
          kind: "svm_transaction",
          signer: "payer",
          transaction_base64: "AQID",
        },
      },
    };
    const session = new Session(
      { baseUrl: "http://127.0.0.1:1" },
      { sessionId: "thread-1" },
    );
    session.commits.ingest(commit);

    function CapabilityBridge({ connected }: { connected: boolean }) {
      const [, rerender] = useState(0);
      const snapshot = useSyncExternalStore(
        session.subscribe,
        session.getSnapshot,
        session.getSnapshot,
      );
      session.syncRuntimeOptions({
        commits: connected ? { sign: vi.fn() } : {},
      });
      useEffect(() => rerender(1), []);
      return (
        <span>
          Commits: {snapshot.commits.length}; eligible:{" "}
          {String(session.commits.canExecute(commit))}
        </span>
      );
    }

    const view = render(<CapabilityBridge connected />);

    await waitFor(() =>
      expect(
        screen.getByText("Commits: 1; eligible: true"),
      ).toBeInTheDocument(),
    );
    view.rerender(<CapabilityBridge connected={false} />);
    await waitFor(() =>
      expect(
        screen.getByText("Commits: 1; eligible: false"),
      ).toBeInTheDocument(),
    );
    session.close();
  });
});
