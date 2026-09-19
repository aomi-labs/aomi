import { Suspense } from "react";
import { OAuthAuthorizeClient } from "./oauth-authorize-client";

export const dynamic = "force-dynamic";

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={<main className="p-6">Loading authorization…</main>}>
      <OAuthAuthorizeClient />
    </Suspense>
  );
}
