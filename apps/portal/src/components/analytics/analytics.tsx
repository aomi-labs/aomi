import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@aomi-labs/widget/host-composition";
import { useCookieConsent } from "@/hooks/use-cookie-consent";

export function CookieConsent() {
  const { showBanner, acceptCookies, declineCookies } = useCookieConsent();

  if (!showBanner) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="border-border bg-background/95 mx-auto max-w-2xl rounded-lg border p-4 shadow-lg backdrop-blur-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <p className="text-muted-foreground text-sm">
              We use cookies to understand how you use our site and improve your
              experience.{" "}
              <Link
                to="/privacy"
                className="text-foreground underline underline-offset-2 hover:no-underline"
              >
                Privacy Policy
              </Link>
            </p>
          </div>
          <div className="flex gap-2 sm:flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={declineCookies}
              className="flex-1 sm:flex-none"
            >
              Decline
            </Button>
            <Button
              size="sm"
              onClick={acceptCookies}
              className="flex-1 sm:flex-none"
            >
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/** Loads gtag once consent is given, never on pages whose URL carries a code. */
export function GoogleAnalytics() {
  const { consent } = useCookieConsent();
  useEffect(() => {
    if (!GA_MEASUREMENT_ID || consent !== "accepted") return;
    if (
      window.location.pathname.startsWith("/link/") ||
      new URLSearchParams(window.location.search).has("return_to")
    )
      return;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
    const analytics = window as typeof window & {
      dataLayer?: unknown[];
      gtag?: (...args: unknown[]) => void;
    };
    analytics.dataLayer ??= [];
    analytics.gtag = function () {
      // gtag queues its `arguments` object, not an array.
      analytics.dataLayer!.push(arguments);
    };
    analytics.gtag("js", new Date());
    analytics.gtag("config", GA_MEASUREMENT_ID);
    return () => script.remove();
  }, [consent]);
  return null;
}
