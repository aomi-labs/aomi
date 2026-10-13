import { Suspense } from "react";
import { OAuthBootstrapClient } from "./oauth-bootstrap-client";

export default function OAuthBootstrapPage() {
  return (
    <Suspense fallback={<main className="p-6">Preparing secure handoff…</main>}>
      <OAuthBootstrapClient />
    </Suspense>
  );
}
