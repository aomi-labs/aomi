"use client";

export const BUILD_SESSION_EXPIRED = "aomi-build:session-expired";

/** A rejected session does not discard the current view or local drafts. */
export const buildFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(BUILD_SESSION_EXPIRED));
  }
  return response;
};
