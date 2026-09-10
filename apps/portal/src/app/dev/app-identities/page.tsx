import { createElement, type CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getAppIcon } from "@/components/icons/app-map";
import { CURATED_APP_IDS, resolveAppIdentity } from "@/lib/apps/app-identity";
import { PackageIcon } from "@portal/components/shell/package-row";
import { toCatalogPackage } from "@portal/components/shell/packages-catalog";

export const dynamic = "force-dynamic";

/** Live catalog IDs observed on 2026-09-07, including integration aliases. */
const LIVE_APP_IDS = [
  "across",
  "auto",
  "binance",
  "bybit",
  "cambrian",
  "cow",
  "default",
  "defillama",
  "dune",
  "dydx",
  "gmx",
  "hyperliquid",
  "jupiter",
  "kaito",
  "kalshi",
  "khalani",
  "krexa",
  "lifi",
  "limitless",
  "manifold",
  "marinade",
  "molinar",
  "morpho",
  "morpho_vaults",
  "neynar",
  "okx",
  "oneinch",
  "orchestrator",
  "para",
  "pelagos",
  "polymarket_rewards",
  "stablefx",
  "svm",
  "svm_transfer",
  "vaultsfyi",
  "world_markets",
  "yearn",
  "zerox",
  "zora",
];

export default function AppIdentitiesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const ids = [...new Set([...LIVE_APP_IDS, ...CURATED_APP_IDS])];
  const apps = ids.map((name) => toCatalogPackage({ name, isPublic: true }));
  apps.sort((a, b) => a.name.localeCompare(b.name));
  const customApps = [
    { name: "treasury-ops", label: "Treasury Ops", isPublic: false },
    { name: "github", label: "Internal Code Review", isPublic: false },
    { name: "custom_risk_monitor", label: "   ", isPublic: false },
  ].map(toCatalogPackage);
  return (
    <main
      style={{
        padding: 32,
        height: "100dvh",
        overflowY: "auto",
        background: "#e9e9ec",
        color: "#242429",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>App identities</h1>
      <p style={{ color: "#606069", marginBottom: 24 }}>
        All {LIVE_APP_IDS.length} live apps plus the curated catalog. Library
        tiles and inline marks use the same identity.
      </p>
      {[false, true].map((dark) => (
        <section
          key={String(dark)}
          data-theme-preview={dark ? "dark" : "light"}
          style={
            {
              background: dark ? "#19191d" : "#fff",
              color: dark ? "#ededf0" : "#242429",
              padding: 24,
              borderRadius: 16,
              marginBottom: 24,
              "--aomi-surface-2": dark ? "#25252b" : "#f4f4f5",
              "--aomi-overlay-border": dark ? "#3a3a42" : "#dedee3",
              "--aomi-accent": dark ? "#ededf0" : "#242429",
            } as CSSProperties
          }
        >
          <h2 style={{ fontSize: 16, marginBottom: 20 }}>
            {dark ? "Dark" : "Light"}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 22,
            }}
          >
            {[...apps, ...customApps].map((app) => {
              const Icon = getAppIcon(app.brandId);
              return (
                <article
                  key={`${app.visibility}:${app.id}`}
                  data-app-id={app.id}
                  data-custom={app.visibility === "personal"}
                >
                  <div
                    style={{
                      height: 50,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <PackageIcon app={app} size="small" />
                    {Icon &&
                      [14, 20, 28].map((size) =>
                        createElement(Icon, {
                          key: size,
                          width: size,
                          height: size,
                        }),
                      )}
                  </div>
                  <p style={{ fontSize: 13, marginTop: 8 }}>{app.name}</p>
                  <p style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>
                    {app.id} ·{" "}
                    {app.visibility === "personal"
                      ? "Custom"
                      : resolveAppIdentity(app.id).category.label}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
