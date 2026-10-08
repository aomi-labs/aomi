/**
 * UI anchors the recorder grabs onto.
 *
 * Every one of these is an accessibility attribute that already exists in the
 * chat UI — no `data-testid` was added to production code for the demo studio.
 * That is deliberate: aria labels are load-bearing for real users, so they are
 * far less likely to be renamed casually than a test-only attribute, and a
 * recorder that breaks loudly when they change is telling us something true.
 *
 * Sources (packages/widget/src/components/assistant-ui/):
 *   thread.tsx        — "Message input", "Send message", "Stop generating",
 *                       data-role="assistant" | "user", "Loading conversation"
 *   working-trace.tsx — "Worked it out" heading, "Show all N steps"
 */

export const sel = {
  /** Composer textarea. */
  composer: '[aria-label="Message input"]',
  /** Submit button. */
  send: '[aria-label="Send message"]',
  /**
   * Only present while a response is streaming. Its appearance and removal are
   * the precise start/end signals for a turn — this is why the recorder never
   * needs a fixed sleep.
   */
  streaming: '[aria-label="Stop generating"]',
  /** Thread hydration spinner; wait for it to clear before typing. */
  loading: '[aria-label="Loading conversation"]',
  /** Assistant message bubbles. */
  assistantMessage: '[data-role="assistant"]',
  /** User message bubbles. */
  userMessage: '[data-role="user"]',
  /**
   * The reasoning trace header. working-trace.tsx renders THREE labels:
   * "Working" while running, "Worked for 5.6s" once the duration is known, and
   * "Worked it out" only as a fallback when elapsed is null. Matching just the
   * fallback (as this did originally) silently burns the full timeout on every
   * take, because the common case never matches.
   */
  workingTrace: "text=/Work(ing|ed)/",
} as const;
