import { useEffect, useState } from "react";

/** Also rendered into the initial HTML: no wallet SDK or account data needed. */
export function PortalStartupShell({
  failed = false,
  onRetry,
}: {
  failed?: boolean;
  onRetry?: () => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  const needsRetry = failed || slow;
  return (
    <main
      aria-busy={!needsRetry}
      className="bg-background text-foreground flex h-full w-full"
      data-testid="portal-startup-shell"
    >
      <aside className="bg-muted/30 hidden w-64 shrink-0 border-r p-5 md:block">
        <span className="text-xl font-semibold tracking-tight">aomi</span>
        <div className="text-muted-foreground mt-10 text-sm">Recent chats</div>
        <div aria-hidden="true" className="mt-4 space-y-3">
          <div className="bg-muted h-3 w-4/5 rounded" />
          <div className="bg-muted h-3 w-3/5 rounded" />
          <div className="bg-muted h-3 w-2/3 rounded" />
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="border-b px-6 py-4 text-sm font-medium">Aomi</header>
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
          <h1 className="text-center text-3xl font-medium tracking-tight">
            What should happen on-chain?
          </h1>
          <div className="mt-8 w-full max-w-2xl rounded-2xl border p-5">
            <p className="text-muted-foreground text-sm">
              Ask Aomi to swap, bridge, send, or deploy…
            </p>
            <div className="mt-8 flex items-center justify-between gap-4">
              <p role="status" className="text-muted-foreground text-sm">
                {needsRetry
                  ? "We couldn’t finish connecting. Please try again."
                  : "Connecting to your session…"}
              </p>
              {needsRetry && onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="bg-foreground text-background shrink-0 rounded-lg px-4 py-2 text-sm"
                >
                  Retry
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="text-muted-foreground text-sm"
                >
                  Send
                </button>
              )}
            </div>
          </div>
          <noscript>
            Enable JavaScript to connect to your chat session.
          </noscript>
        </div>
      </section>
    </main>
  );
}
