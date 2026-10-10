import { Suspense } from "react";
import { OAuthConsentClient } from "./oauth-consent-client";

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<main className="p-6">Loading consent…</main>}>
      <OAuthConsentClient />
    </Suspense>
  );
}
