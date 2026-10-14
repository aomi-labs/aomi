import type { Event, MessageEvent } from "../agent/types";

/** Active conversation derived from the append-only event ledger. A `branch`
 * event (Edit or Rerun) removes a user message and everything after it.
 * Removed events remain in SessionSnapshot.events for receipts and audit.
 */
export function projectConversationEvents(events: readonly Event[]): Event[] {
  let active: Event[] = [];
  const removedKeys = new Set<string>();
  const removedTurns = new Set<string>();
  const interruptedTurns = new Set<string>();
  for (const event of events) {
    if (event.type === "branch") {
      for (const key of event.removed_message_keys) removedKeys.add(key);
      for (const turn of event.removed_turn_ids) removedTurns.add(turn);
      // Branches from the first release kept the user message, with new text
      // and the new run's turn, instead of removing it.
      const legacy = !event.removed_message_keys.includes(
        event.user_message_key,
      );
      active = active.flatMap((previous) => {
        if (
          legacy &&
          previous.type === "message" &&
          previous.sender === "user" &&
          previous.message_key === event.user_message_key
        ) {
          return [
            { ...previous, content: event.content, turn_id: event.turn_id },
          ];
        }
        return hidden(previous) ? [] : [previous];
      });
      continue;
    }
    if (hidden(event)) continue;
    if (event.type === "turn_state_changed" && event.turn_id) {
      if (
        interruptedTurns.has(event.turn_id) &&
        (event.state === "processing" || event.state === "awaiting_action")
      )
        continue;
      if (event.state === "interrupted") interruptedTurns.add(event.turn_id);
    }
    if (
      event.type === "message" &&
      event.is_streaming &&
      event.turn_id &&
      interruptedTurns.has(event.turn_id)
    )
      continue;
    active.push(event);
  }
  return active;

  function hidden(event: Event): boolean {
    return Boolean(
      (event.turn_id && removedTurns.has(event.turn_id)) ||
      (event.type === "message" &&
        event.message_key &&
        removedKeys.has(event.message_key)),
    );
  }
}

export function conversationMessages(events: readonly Event[]): MessageEvent[] {
  const messages = new Map<string, MessageEvent>();
  for (const event of projectConversationEvents(events)) {
    if (event.type === "message")
      messages.set(event.message_key ?? event.event_id, event);
  }
  return [...messages.values()];
}
