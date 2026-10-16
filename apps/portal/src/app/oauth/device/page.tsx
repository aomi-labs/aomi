import { Suspense } from "react";
import { OAuthDeviceClient } from "./oauth-device-client";

export const dynamic = "force-dynamic";

export default function OAuthDevicePage() {
  return (
    <Suspense fallback={null}>
      <OAuthDeviceClient />
    </Suspense>
  );
}
