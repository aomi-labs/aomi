import { Suspense } from "react";
import { DeviceAuthClient } from "./device-auth-client";

export const dynamic = "force-dynamic";

export default function DeviceAuthPage() {
  return (
    <Suspense fallback={<DeviceAuthShell status="Loading..." />}>
      <DeviceAuthClient />
    </Suspense>
  );
}

function DeviceAuthShell({ status }: { status: string }) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to Aomi CLI
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">{status}</p>
      </section>
    </main>
  );
}
