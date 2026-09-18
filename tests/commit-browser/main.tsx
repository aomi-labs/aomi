import React from "react";
import { createRoot } from "react-dom/client";
import { CommitController } from "../../packages/client/src/commits";
import type { AomiClient } from "../../packages/client/src/client";
import { CommitReview } from "../../apps/shadcn-registry/src/components/activity-sidebar/commit-review";
import { install } from "./runtime";

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
    venueBroadcast: capabilities.walletBroadcast,
  },
);
install(controller, capabilities);
controller.ingest(fixture.view);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main>
      <h1>Commit integration fixture</h1>
      <CommitReview />
    </main>
  </React.StrictMode>,
);
