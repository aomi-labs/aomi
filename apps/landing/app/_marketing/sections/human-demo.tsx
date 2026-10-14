"use client";

import { Component, type ReactNode } from "react";
import { AomiFrame } from "@aomi-labs/widget/frame";
import { LandingWalletKitProvider } from "../../components/landing-wallet-kit-provider";
import styles from "../../sections/hero.module.css";

const DEMO_BACKEND_URL = "/";

class DemoErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[520px] w-full flex-col items-center justify-center gap-2 bg-zinc-50 px-6 text-center md:min-h-[590px]">
          <p className="text-sm font-medium text-zinc-800">
            Demo failed to load
          </p>
          <p className="max-w-md text-xs text-zinc-500">
            {this.state.error.message || "Unknown error"}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Isolated so marketing pages can compile without waiting on the widget graph. */
export function HumanDemo() {
  return (
    <div
      className="relative mb-4 h-[520px] w-full max-w-[1040px] origin-top overflow-hidden bg-aomi-bg md:h-[590px]"
      data-testid="human-demo"
    >
      {/* Visible while LandingWalletKitProvider returns null pre-mount */}
      <div
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center bg-aomi-bg"
        aria-hidden
      >
        <span className="text-sm font-medium text-zinc-500">Loading demo…</span>
      </div>
      <div className="relative z-10 h-full w-full">
        <DemoErrorBoundary>
          <LandingWalletKitProvider>
            <AomiFrame.Root
              height="100%"
              width="100%"
              className={`${styles.demoFrame} aui-suggestions-marquee overflow-hidden`}
              defaultSidebarOpen={false}
              walletPosition="footer"
              walletFamilies={["evm", "solana"]}
              backendUrl={DEMO_BACKEND_URL}
            >
              <AomiFrame.Header />
              <AomiFrame.Composer
                withControl
                welcomeTitle="What should happen on-chain?"
                controlBarProps={{ hideApiKey: true, hideNetwork: false }}
              />
            </AomiFrame.Root>
          </LandingWalletKitProvider>
        </DemoErrorBoundary>
      </div>
    </div>
  );
}
