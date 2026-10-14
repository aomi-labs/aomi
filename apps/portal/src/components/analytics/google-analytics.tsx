"use client";
import { useEffect } from "react";
import { useCookieConsent } from "@/hooks/use-cookie-consent";
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
export function GoogleAnalytics() {
  const { consent } = useCookieConsent();
  useEffect(() => {
    if (!GA_MEASUREMENT_ID || consent !== "accepted") return;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
    const analytics = window as typeof window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
    analytics.dataLayer ??= [];
    analytics.gtag = function () { analytics.dataLayer!.push(arguments); };
    analytics.gtag("js", new Date());
    analytics.gtag("config", GA_MEASUREMENT_ID);
    return () => script.remove();
  }, [consent]);
  return null;
}
