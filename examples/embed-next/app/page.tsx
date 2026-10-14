"use client";

import { AomiWidget } from "@aomi-labs/widget";

export default function Page() {
  return (
    <main>
      <header>
        <h1>Aomi chat</h1>
        <p>
          A standard Next.js client component with browser wallet
          authentication.
        </p>
      </header>
      <AomiWidget
        applicationId={process.env.NEXT_PUBLIC_AOMI_APPLICATION_ID || "1"}
        baseUrl={process.env.NEXT_PUBLIC_AOMI_API_URL || "https://chat.aomi.dev"}
        height={"min(760px, 85vh)"}
      />
    </main>
  );
}
