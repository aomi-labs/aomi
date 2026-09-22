import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CommitController } from "../../packages/client/src/commits";
import type { AomiClient } from "../../packages/client/src/client";
import { install, useAomiRuntime } from "./runtime";

const fixture = await fetch("/__fixture").then((response) => response.json());
const request = async (
  method: string,
  path: string,
  options?: { body?: unknown },
) => {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.code ?? "Commit request failed");
  return body;
};
const bridge = window as unknown as {
  fixtureSign: (id: string, payload: unknown) => Promise<string[]>;
  fixtureBroadcast: (id: string, bytes: string) => Promise<string>;
};
const capabilities = {
  sign: async (view: { commit_id: string }, payload: unknown) =>
    bridge.fixtureSign(view.commit_id, payload),
  walletBroadcast: async (view: { commit_id: string }, bytes: string) =>
    bridge.fixtureBroadcast(view.commit_id, bytes),
};
const controller = new CommitController(
  { request } as unknown as AomiClient,
  fixture.view.thread_id,
  {
    ...capabilities,
    venueBroadcast: capabilities.walletBroadcast,
  },
);
install(controller);
controller.ingest(fixture.view);

function CommitDriver() {
  const { commits, commitController } = useAomiRuntime();
  const [error, setError] = useState<string>();
  const commit = commits[0];
  if (!commit) return null;
  const label =
    commit.action?.kind === "sign"
      ? "Sign"
      : commit.action?.kind === "broadcast"
        ? "Broadcast"
        : "Continue";
  return (
    <article data-commit-id={commit.commit_id}>
      <p role="status">{commit.state}</p>
      {commit.action && (
        <button
          type="button"
          onClick={() => {
            setError(undefined);
            void commitController
              .execute(commit.commit_id)
              .catch((failure) =>
                setError(
                  failure instanceof Error ? failure.message : "Commit failed",
                ),
              );
          }}
        >
          {label}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main>
      <h1>Commit integration fixture</h1>
      <CommitDriver />
    </main>
  </React.StrictMode>,
);
