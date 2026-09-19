import { Suspense } from "react";
import { OAuthBootstrapClient } from "./oauth-bootstrap-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function OAuthBootstrapPage() {
  return (
    <Suspense fallback={<main className="p-6">Preparing secure handoff…</main>}>
      <OAuthBootstrapClient />
    </Suspense>
  );
}
