import { WalletClient } from "./wallet-client";

// The whole page is driven by `window.Telegram` and the Privy provider, so
// there is nothing to prerender — and prerendering it makes a misconfigured
// `NEXT_PUBLIC_PRIVY_APP_ID` fail the *build* instead of rendering the
// "not configured" card it was written to render.
export const dynamic = "force-dynamic";

export default function Home() {
  return <WalletClient />;
}
