import { useState, useEffect, useCallback } from "react";

const CONSENT_KEY = "aomi-cookie-consent";
// Same-tab broadcast: the native `storage` event only fires in *other* tabs,
// so we emit this to keep every hook instance in the current tab in sync.
const CONSENT_EVENT = "aomi-cookie-consent-change";

export type ConsentStatus = "pending" | "accepted" | "declined";

function readStored(): ConsentStatus {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === "accepted" || stored === "declined") {
      return stored;
    }
  } catch {
    // localStorage can be unavailable (private mode, disabled storage) — treat as pending.
  }
  return "pending";
}

function writeStored(value: ConsentStatus) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Persisting is best-effort; in-memory state still drives the UI this session.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

export function useCookieConsent() {
  const [consent, setConsent] = useState<ConsentStatus>("pending");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setConsent(readStored());
    setIsLoaded(true);

    const sync = (event: Event) => {
      const detail =
        event instanceof CustomEvent ? (event.detail as unknown) : undefined;
      if (detail === "accepted" || detail === "declined") {
        setConsent(detail);
        return;
      }
      setConsent(readStored());
    };
    // `storage` covers other tabs; the custom event covers this tab's other hook instances.
    window.addEventListener("storage", sync);
    window.addEventListener(CONSENT_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CONSENT_EVENT, sync);
    };
  }, []);

  const acceptCookies = useCallback(() => {
    writeStored("accepted");
    setConsent("accepted");
  }, []);

  const declineCookies = useCallback(() => {
    writeStored("declined");
    setConsent("declined");
  }, []);

  return {
    consent,
    isLoaded,
    acceptCookies,
    declineCookies,
    showBanner: isLoaded && consent === "pending",
  };
}
