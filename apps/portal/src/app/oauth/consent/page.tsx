import { Suspense } from "react";
import { OAuthConsentClient } from "./oauth-consent-client";

export const dynamic = "force-dynamic";

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={null}>
      <OAuthConsentClient />
    </Suspense>
  );
}
