import { CliSession } from "../cli-session";
import { printPaymentEvent } from "../output";
import { createSessionRenderer } from "../session-renderer";
import {
  applyRequestedModelIfPresent,
  ingestSecretsForSession,
} from "../context";
import { fatal } from "../errors";
import type { CliConfig } from "../types";
import { parseSolanaKeypairSecret } from "../solana-signer";
import type { SendOptions } from "@aomi-labs/client";
import type { Session as ClientSession } from "@aomi-labs/client";
import type { Event, MessageEvent } from "@aomi-labs/client";
import { AgentApiError } from "@aomi-labs/client";

const STOPPED_TURN_STATES = new Set([
  "awaiting_action",
  "complete",
  "interrupted",
  "failed",
]);

function waitForTurnStop(session: ClientSession): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const state = session.getSnapshot().turnState;
      if (!state || !STOPPED_TURN_STATES.has(state)) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = session.subscribe(check);
    check();
  });
}

/**
 * Derive the Solana public key from a keypair secret string if provided.
 * Returns undefined on any parse failure (non-fatal — just omits svm.address).
 */
function deriveSvmAddress(
  solanaPrivateKey: string | undefined,
): string | undefined {
  if (!solanaPrivateKey) return undefined;
  try {
    return parseSolanaKeypairSecret(solanaPrivateKey).publicKey.toBase58();
  } catch {
    return undefined;
  }
}

export function resolveSvmAddressForChat(
  persistedSvmAddress: string | undefined,
  solanaPrivateKey: string | undefined,
): string | undefined {
  return deriveSvmAddress(solanaPrivateKey) ?? persistedSvmAddress;
}

export function printBoundaryForTurn(
  events: readonly Event[],
  messages: readonly MessageEvent[],
  turnId: string | undefined,
) {
  const firstTurnEvent = events.find((event) => event.turn_id === turnId);
  return {
    handledSequence: firstTurnEvent ? firstTurnEvent.sequence - 1 : 0,
    printedAgentCount: messages.filter(
      (message) => message.sender === "agent" && message.turn_id !== turnId,
    ).length,
  };
}

/** One session and renderer for the whole interactive conversation. */
export async function openInteractiveChat(config: CliConfig, verbose: boolean) {
  let cli = CliSession.loadOrCreate(config);
  const credentialServer = cli.baseUrl;
  const walletIdentity = (state: CliSession) =>
    JSON.stringify([
      state.publicKey,
      state.privateKey,
      state.svmPublicKey,
      state.resolvedSvmPrivateKey(),
    ]);
  const credentialWallet = walletIdentity(cli);
  const sessionConfig = (next: CliSession): CliConfig => {
    const sameServer =
      new URL(next.baseUrl).origin === new URL(credentialServer).origin;
    const sameWallet = walletIdentity(next) === credentialWallet;
    if (sameServer && sameWallet) return config;
    const scoped = { ...config };
    // Startup credentials and upload secrets belong only to the original
    // server; startup signing keys also belong to its original wallet choice.
    if (!sameServer) {
      scoped.secrets = {};
      delete scoped.apiKey;
      delete scoped.accountBearer;
    }
    delete scoped.privateKey;
    delete scoped.solanaPrivateKey;
    return scoped;
  };
  let session = cli.createClientSession(sessionConfig(cli), {
    onPayment: printPaymentEvent,
  });
  let closed = false;
  let ready = false;
  let unsubscribe = () => {};
  let unobserve = () => {};
  const prepare = async (current: ClientSession, state: CliSession) => {
    const scoped = sessionConfig(state);
    try {
      await ingestSecretsForSession(scoped, state, current.client);
      await applyRequestedModelIfPresent(scoped, state, current);
      try {
        await current.fetchCurrentState();
      } catch (error) {
        if (
          !(
            error instanceof AgentApiError &&
            error.status === 404 &&
            error.code === "session_not_found"
          )
        )
          throw error;
      }
    } catch (error) {
      current.close();
      throw error;
    }
    if (closed) {
      current.close();
      return;
    }
    const renderer = createSessionRenderer(current, verbose, "interactive");
    unsubscribe = current.subscribe(() => {
      if (!closed && current === session) renderer.render();
    });
    unobserve = current.observe();
    ready = true;
  };
  await prepare(session, cli);
  let syncing: Promise<void> | undefined;
  const sync = (): Promise<void> => {
    if (closed) return Promise.reject(new Error("Interactive chat is closed"));
    if (syncing) return syncing;
    syncing = (async () => {
      // Saved identity is authoritative. Reapplying startup auth/server flags
      // here could overwrite another process's deliberate account/server switch.
      const next =
        CliSession.load() ??
        CliSession.loadOrCreate({ ...config, freshSession: false });
      if (ready && next.syncClientSession(session, sessionConfig(next))) return;
      ready = false;
      unsubscribe();
      unobserve();
      session.close();
      cli = next;
      session = cli.createClientSession(sessionConfig(cli), {
        onPayment: printPaymentEvent,
      });
      await prepare(session, cli);
    })().finally(() => {
      syncing = undefined;
    });
    return syncing;
  };
  return {
    get session() {
      return session;
    },
    send: async (text: string) => {
      await sync();
      const snapshot = session.getSnapshot();
      const active = snapshot.control
        ? snapshot.control.active_turn_id
        : snapshot.turnState === "processing" ||
            snapshot.turnState === "awaiting_action"
          ? snapshot.turnId
          : undefined;
      if (active) await session.steer(text, { targetTurnId: active });
      else await session.sendAsync(text);
    },
    queue: async (text: string) => {
      await sync();
      await session.queue(text);
    },
    cancel: async (turnId?: string) => {
      await sync();
      if (turnId) await session.cancel({ targetTurnId: turnId });
      else await session.interrupt();
    },
    sync,
    close: () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      unobserve();
      session.close();
    },
  };
}

export async function turnInputCommand(
  config: CliConfig,
  message: string,
  options: {
    intent: "steer" | "queue";
    inputId: string;
    targetTurnId?: string;
    expectedInputRevision?: number;
  },
): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config, {
    onPayment: printPaymentEvent,
  });
  try {
    await ingestSecretsForSession(config, cli, session.client);
    await session.fetchCurrentState();
    const page =
      options.intent === "steer"
        ? await session.steer(message, options)
        : await session.queue(message, { inputId: options.inputId });
    console.log(
      JSON.stringify({
        sessionId: cli.sessionId,
        input: page.input,
        control: page.control,
      }),
    );
  } finally {
    session.close();
  }
}

export async function chatCommand(
  config: CliConfig,
  message: string,
  verbose: boolean,
  branch: SendOptions = {},
): Promise<void> {
  if (!message && !branch.regenerate) {
    fatal("Usage: aomi chat <message>");
  }

  const cli = CliSession.loadOrCreate(config);
  const session = cli.createClientSession(config, {
    onPayment: printPaymentEvent,
  });

  try {
    await ingestSecretsForSession(config, cli, session.client);
    await applyRequestedModelIfPresent(config, cli, session);
    const renderer = createSessionRenderer(session, verbose, "one-shot");
    renderer.begin();
    if (branch.edit && branch.regenerate) fatal("Choose --edit or --rerun.");
    await session.sendAsync(message, branch);
    const boundary = printBoundaryForTurn(
      session.getSnapshot().events,
      session.getSnapshot().messages,
      session.getSnapshot().turnId,
    );
    renderer.setBoundary(boundary);
    const unsubscribe = session.subscribe(renderer.render);
    try {
      renderer.render();
      await waitForTurnStop(session);
      renderer.render();
      renderer.finish();
    } finally {
      unsubscribe();
    }
  } finally {
    session.close();
  }
}
