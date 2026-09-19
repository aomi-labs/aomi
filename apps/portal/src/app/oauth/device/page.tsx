import { Suspense } from "react";
import { OAuthDeviceClient } from "./oauth-device-client";

export const dynamic = "force-dynamic";

export default function OAuthDevicePage() {
  return (
    <Suspense
      fallback={<main className="p-6">Loading device authorization…</main>}
    >
      <OAuthDeviceClient />
    </Suspense>
  );
}
