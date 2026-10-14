import type { SessionSnapshot } from "@aomi-labs/client";

/** A message is on its way and the backend has not accepted it yet. */
export const isSending = (snapshot: SessionSnapshot) =>
  snapshot.isSubmitting || Boolean(snapshot.isStartUncertain);

/** The backend is still working on the current turn. */
export const isTurnActive = (snapshot: SessionSnapshot) =>
  snapshot.turnState === "processing" ||
  snapshot.turnState === "awaiting_action";

/** The current turn has finished, failed or been stopped. */
export const isTurnOver = (snapshot: SessionSnapshot) =>
  snapshot.turnState === "complete" ||
  snapshot.turnState === "failed" ||
  snapshot.turnState === "interrupted" ||
  Boolean(
    snapshot.terminalTurns?.some((turn) => turn.turnId === snapshot.turnId),
  );

/** The user stopped the current turn. */
export const isTurnStopped = (snapshot: SessionSnapshot) =>
  Boolean(snapshot.stoppedTurnId) && snapshot.stoppedTurnId === snapshot.turnId;

/** The chat has content the backend knows about. */
export const hasConversation = (snapshot: SessionSnapshot | undefined) =>
  Boolean(
    snapshot &&
    (snapshot.events.length || snapshot.turnId || isSending(snapshot)),
  );

/**
 * Only streamed text and tool output are on screen: no send in flight, no
 * stop, error, action or commit waiting. Rendering those may lag a frame.
 */
export const isStreamingTextOnly = (snapshot: SessionSnapshot) =>
  snapshot.turnState === "processing" &&
  !isSending(snapshot) &&
  !snapshot.isStopping &&
  snapshot.error === undefined &&
  !snapshot.stoppedTurnId &&
  !isTurnOver(snapshot) &&
  snapshot.actions.length === 0 &&
  snapshot.commits.length === 0;
