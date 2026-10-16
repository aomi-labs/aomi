import { Suspense } from "react";
import { OAuthAuthorizeClient } from "./oauth-authorize-client";

export const dynamic = "force-dynamic";

export default function OAuthAuthorizePage() {
  return (
    <Suspense fallback={null}>
      <OAuthAuthorizeClient />
    </Suspense>
  );
}
