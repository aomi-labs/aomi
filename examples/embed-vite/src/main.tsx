import { createRoot } from "react-dom/client";
import {
  AomiWidget,
  paraAuth,
  privyAuth,
  type AomiRoutingConfig,
  type AomiWidgetAuth,
} from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";
import "./styles.css";

const baseUrl =
  import.meta.env.VITE_AOMI_API_URL?.trim() || "http://localhost:3000";
const params = new URLSearchParams(window.location.search);
const configuredApplicationId =
  import.meta.env.VITE_AOMI_APPLICATION_ID?.trim();
const applicationId =
  params.get("application_id")?.trim() || configuredApplicationId;
const numericApplicationId = Number(applicationId);
const routing: AomiRoutingConfig =
  Number.isSafeInteger(numericApplicationId) && numericApplicationId > 0
    ? {
        targets: [
          { mode: "auto" },
          {
            mode: "direct",
            apps: [{ applicationId: numericApplicationId }],
          },
        ],
      }
    : { targets: [{ mode: "auto" }] };
const providerParam = params.get("provider");
const provider =
  providerParam === "para" || providerParam === "privy"
    ? providerParam
    : "browser";
const initialThreadId =
  applicationId === configuredApplicationId
    ? import.meta.env.VITE_AOMI_THREAD_ID?.trim()
    : undefined;
const paraApiKey = import.meta.env.VITE_PARA_API_KEY?.trim();
const privyAppId = import.meta.env.VITE_PRIVY_APP_ID?.trim();
// A provider fixture without its public key shows setup help instead.
const auth: AomiWidgetAuth | undefined =
  provider === "para" && paraApiKey
    ? paraAuth({
        apiKey: paraApiKey,
        environment:
          import.meta.env.VITE_PARA_ENVIRONMENT === "BETA" ? "BETA" : "PROD",
      })
    : provider === "privy" && privyAppId
      ? privyAuth({ appId: privyAppId })
      : provider === "browser"
        ? { type: "browser_wallet" }
        : undefined;

function providerHref(nextProvider: "browser" | "para" | "privy") {
  const next = new URLSearchParams(params);
  next.set("provider", nextProvider);
  return `?${next.toString()}`;
}

function App() {
  if (!applicationId || !auth) {
    return (
      <main className="setup">
        <h1>Aomi widget consumer</h1>
        <p>
          Copy .env.example to .env.local and set VITE_AOMI_APPLICATION_ID
          {provider === "para" ? " and VITE_PARA_API_KEY" : ""}
          {provider === "privy" ? " and VITE_PRIVY_APP_ID" : ""}.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Cross-origin integration fixture</p>
        <h1>Aomi Widget</h1>
        <p>
          This Vite app embeds the widget and talks to a separate Portal origin
          using an origin-bound widget session token. It does not rely on Portal
          cookies.
        </p>
        <nav className="provider-fixtures" aria-label="Wallet provider fixture">
          <a
            className={provider === "browser" ? "active" : undefined}
            href={providerHref("browser")}
          >
            Browser wallets
          </a>
          <a
            className={provider === "para" ? "active" : undefined}
            href={providerHref("para")}
          >
            Para embedded
          </a>
          <a
            className={provider === "privy" ? "active" : undefined}
            href={providerHref("privy")}
          >
            Privy embedded
          </a>
        </nav>
        <p className="fixture-note">
          Provider selection and allowed routing are host concerns. This fixture
          offers Auto plus its hosted application as Direct.
        </p>
      </header>
      <AomiWidget
        applicationId={applicationId}
        initialThreadId={initialThreadId}
        baseUrl={baseUrl}
        auth={auth}
        routing={routing}
        wallets={{
          evm: {
            preset: "popular",
          },
          solana: false,
        }}
        height="min(780px, calc(100vh - 230px))"
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
