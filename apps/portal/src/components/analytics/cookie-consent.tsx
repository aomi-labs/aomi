"use client";

import Link from "next/link";
import { Button } from "@aomi-labs/widget/host-composition";
import { useCookieConsent } from "@/hooks/use-cookie-consent";

export function CookieConsent() {
  const { showBanner, acceptCookies, declineCookies } = useCookieConsent();

  if (!showBanner) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              We use cookies to understand how you use our site and improve your experience.{" "}
              <Link
                href="/privacy"
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
