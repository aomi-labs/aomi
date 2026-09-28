import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  Aomi,
  commitCapabilities,
  createAccountSessionProvider,
  createSiweAccountAuthAdapter,
  type Action,
  type AgentRun,
  type CommitView,
  type MessageEvent,
  type Session as ClientSession,
  type Wallets,
} from "@aomi-labs/client";
import { privateKeyToAccount } from "viem/accounts";
import { createPortalOriginFetch } from "./shared/portal-origin-fetch";
import { createViemWalletFromEnvironment } from "./shared/viem-wallet";

const terminal = createInterface({ input: stdin, output: stdout });
const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const portalFetch = createPortalOriginFetch(baseUrl);
const wallet = createViemWalletFromEnvironment();
const authMode = process.env.AOMI_WALLET_AUTH?.trim() || "guest";
if (authMode !== "guest" && authMode !== "siwe") {
  throw new Error("AOMI_WALLET_AUTH must be guest or siwe");
}
if (authMode === "siwe" && !wallet?.evm) {
  throw new Error(
    "SIWE mode requires AOMI_PRIVATE_KEY, EVM_CHAIN_ID, and EVM_RPC_URL",
  );
}
const siweAccount =
  authMode === "siwe"
    ? privateKeyToAccount(process.env.AOMI_PRIVATE_KEY as `0x${string}`)
    : undefined;
const accountSession =
  siweAccount && wallet?.evm
    ? createAccountSessionProvider({
        baseUrl,
        fetch: portalFetch,
        adapter: createSiweAccountAuthAdapter({
          getSigner: async () => ({
            address: siweAccount.address,
            chainId: readChainId(wallet)!,
            signMessage: (message) => siweAccount.signMessage({ message }),
          }),
        }),
      })
    : undefined;
const aomi = new Aomi({
  baseUrl,
  fetch: accountSession ? portalFetch : undefined,
  wallet,
  ...(accountSession ? { getAccountBearer: accountSession, guest: false } : {}),
});
const commitOps = wallet ? commitCapabilities(wallet) : {};
const printedMessages = new Set<string>();
const handledActions = new Set<string>();
const handledCommits = new Set<string>();

let activeRun: AgentRun | undefined;
let sessionId: string = crypto.randomUUID();
let reviewQueue: Promise<void> = Promise.resolve();

console.log("Aomi headless client");
console.log(`API: ${baseUrl}`);
console.log(
  wallet?.evm
    ? `Mode: ${authMode === "siwe" ? "SIWE account" : "guest session"} + Viem wallet ${wallet.evm.address} on chain ${readChainId(wallet)}`
    : "Mode: guest session (no wallet)",
);
console.log("Type a message, or /exit to quit.\n");

process.once("SIGINT", () => {
  void activeRun?.interrupt().catch(() => undefined);
  terminal.close();
});

try {
  while (true) {
    const prompt = (await terminal.question("you> ")).trim();
    if (prompt === "/exit") break;
    if (!prompt) continue;

    const run = aomi.agent.run(prompt, { sessionId });
    activeRun = run;
    run.on("action", (action) => {
      console.log(`\n[action] ${describeAction(action)} (${action.state})`);
      // A legacy Action holds the turn in awaiting_action, so it must be
      // resolved against the live run before run.result() can complete.
      queueAction(run.session, action);
    });
    run.on("commit", (commit) => {
      console.log(`\n[commit] ${describeCommit(commit)} (${commit.state})`);
      // The run closes its live session when it completes. Reopen the durable
      // session below before executing wallet work.
    });

    try {
      const result = await run.result();
      sessionId = result.sessionId;
      printNewAgentMessages(result.messages);
      // A commit can arrive after the last streamed page. Reconnect to the
      // durable view before accepting another terminal prompt.
      const session = await aomi.agent.openSession(sessionId);
      try {
        for (const action of session.actions.all())
          queueAction(session, action);
        for (const commit of sortedCommits(session.commits.all()))
          queueCommit(session, commit);
        await reviewQueue;
      } finally {
        session.close();
      }
    } catch (error) {
      console.error(`\n[error] ${errorMessage(error)}`);
    } finally {
      activeRun = undefined;
      console.log();
    }
  }
} finally {
  terminal.close();
  accountSession?.dispose();
}

function queueAction(session: ClientSession, action: Action) {
  if (action.state !== "pending") return;
  const key = `${action.id}:${action.revision}`;
  if (handledActions.has(key)) return;
  handledActions.add(key);
  enqueueReview(
    () => reviewAction(session, action),
    async () => {
      handledActions.delete(key);
      // A failed Action resolution otherwise leaves run.result() waiting on an
      // awaiting_action turn forever. Interrupt that turn so the terminal can
      // recover on the next prompt.
      if (session.getSnapshot().turnState === "awaiting_action") {
        await session.interrupt();
      }
    },
  );
}

function enqueueReview(
  review: () => Promise<void>,
  onError: () => void | Promise<void>,
) {
  reviewQueue = reviewQueue.then(review).catch(async (error: unknown) => {
    console.error(`[wallet] failed: ${errorMessage(error)}`);
    try {
      await onError();
    } catch (cleanupError) {
      console.error(`[wallet] recovery failed: ${errorMessage(cleanupError)}`);
    }
  });
}

function queueCommit(session: ClientSession, commit: CommitView) {
  if (
    !commit.action ||
    ["confirmed", "rejected", "failed", "expired"].includes(commit.state)
  ) {
    return;
  }
  const key = `${commit.commit_id}:${commit.version}`;
  if (handledCommits.has(key)) return;
  handledCommits.add(key);
  enqueueReview(
    () => reviewCommit(session, commit),
    () => {
      handledCommits.delete(key);
    },
  );
}

async function reviewCommit(session: ClientSession, commit: CommitView) {
  const fresh = await session.commits.refresh(commit.commit_id);
  if (!fresh.action) return;
  // Execute one reviewed transition per approval. The controller can advance
  // sign -> broadcast in one call when both capabilities are present.
  session.commits.setCapabilities(
    fresh.action.kind === "sign"
      ? { ...commitOps, walletBroadcast: undefined, venueBroadcast: undefined }
      : { ...commitOps, sign: undefined },
  );
  const review = session.commits.review(commit.commit_id);
  console.log(`\n[review] ${describeCommit(fresh)}`);
  console.log(JSON.stringify(fresh, null, 2));
  if (review) console.log(JSON.stringify(review, null, 2));
  if (!session.commits.canExecute(fresh)) {
    console.log("[wallet] the configured wallet cannot execute this commit");
    return;
  }

  const approval = (await terminal.question("Approve this commit step? [y/N] "))
    .trim()
    .toLowerCase();
  if (approval !== "y" && approval !== "yes") {
    await session.commits.reject(fresh.commit_id);
    console.log("[wallet] rejected");
    return;
  }

  const resolved = await session.commits.execute(fresh.commit_id, {
    expectedVersion: fresh.version,
    expectedReviewDigest: fresh.review?.digest,
  });
  console.log(`[commit] ${resolved.commit_id}: ${resolved.state}`);
  if (resolved.action && resolved.version > fresh.version) {
    await reviewCommit(session, resolved);
  }
}

async function reviewAction(session: ClientSession, action: Action) {
  console.log(
    `\n[review] ${describeAction(action)} · ${action.id} · revision ${action.revision}`,
  );
  console.log(JSON.stringify(action.request, null, 2));
  if (!session.actions.canExecute(action.id)) {
    console.log("[wallet] the configured wallet cannot execute this Action");
    await session.actions.reject(
      action.id,
      "No compatible wallet capability in the partner terminal",
    );
    return;
  }

  const approval = (await terminal.question("Approve this Action? [y/N] "))
    .trim()
    .toLowerCase();
  if (approval !== "y" && approval !== "yes") {
    await session.actions.reject(action.id, "Rejected in the partner terminal");
    console.log("[wallet] rejected");
    return;
  }

  const resolved = await session.actions.execute(action.id);
  console.log(`[wallet] ${resolved.state}`);
}

function printNewAgentMessages(messages: readonly MessageEvent[]) {
  for (const message of messages) {
    if (message.sender !== "agent" || printedMessages.has(message.event_id)) {
      continue;
    }
    printedMessages.add(message.event_id);
    console.log(`\naomi> ${message.content}`);
  }
}

function describeAction(action: Action): string {
  switch (action.request.type) {
    case "execute_evm":
      return `EVM transaction · ${action.request.transactions.length} call(s)`;
    case "execute_svm":
      return `SVM transaction · ${action.request.transactions.length} leg(s)`;
    case "sign":
      return `${action.request.chainFamily.toUpperCase()} signing · ${action.request.description}`;
  }
}

function describeCommit(commit: CommitView): string {
  return `${commit.chain_family.toUpperCase()} ${commit.action?.kind ?? "status"} · ${commit.commit_id} · ${commit.broadcaster}`;
}

function sortedCommits(commits: readonly CommitView[]): CommitView[] {
  // A batch successor cannot execute before its predecessor. The wire's
  // batch index is authoritative; preserve arrival order across batches.
  return [...commits].sort((left, right) =>
    left.batch && right.batch && left.batch.batch_id === right.batch.batch_id
      ? left.batch.index - right.batch.index
      : 0,
  );
}

function readChainId(wallets: Wallets): number | undefined {
  const value = wallets.evm?.chainId;
  return typeof value === "function" ? value() : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
