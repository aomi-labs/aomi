"use client";

import { useSyncExternalStore } from "react";

type Review = { url: string } | null;

/** The Para review page currently waiting for the user, if any. */
export function createParaReviewStore() {
  let review: Review = null;
  const listeners = new Set<() => void>();
  return {
    get: () => review,
    set(next: Review) {
      review = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ParaReviewStore = ReturnType<typeof createParaReviewStore>;

/**
 * Para asks the user to review a transaction on its own page. The page opens
 * from this button's click, a fresh user gesture, so the browser does not
 * block it; a link is the fallback when the window is still refused.
 */
export function ParaTransactionReviewPrompt({
  store,
}: {
  store: ParaReviewStore;
}) {
  const review = useSyncExternalStore(store.subscribe, store.get, () => null);
  if (!review) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Review transaction in Para"
      data-testid="para-transaction-review"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        display: "flex",
        gap: 12,
        alignItems: "center",
        padding: "12px 16px",
        borderRadius: 12,
        background: "#111",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        fontSize: 14,
      }}
    >
      <span>Para needs you to review this transaction.</span>
      <button
        type="button"
        onClick={() => {
          window.open(
            review.url,
            "para-transaction-review",
            "popup=yes,width=550,height=750",
          );
        }}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: 0,
          background: "#fff",
          color: "#111",
          cursor: "pointer",
        }}
      >
        Review in Para
      </button>
      <a
        href={review.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: "#bbb" }}
      >
        Open in new tab
      </a>
    </div>
  );
}
