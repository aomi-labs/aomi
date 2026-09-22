import React from "react";
import { createRoot } from "react-dom/client";
import "@fixture-source/apps/shadcn-registry/src/package.css";
import { ActivitySidebar } from "@fixture-source/apps/shadcn-registry/src/components/activity-sidebar/activity-sidebar";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.className = theme;

function Fixture() {
  return (
    <main
      data-testid="transaction-review-fixture"
      className="bg-aomi-bg text-aomi-fg grid h-[825px] w-full max-w-[1355px] grid-cols-[minmax(0,1fr)_376px] overflow-hidden"
    >
      <section
        id="fixture-chat"
        className="relative px-16 py-12"
        aria-label="Fixture chat context"
      >
        <p className="bg-aomi-surface ml-auto w-fit rounded-2xl px-5 py-3 text-[15px]">
          Deposit 100 USDC to Aave
        </p>
        <article className="border-aomi-border mt-12 rounded-2xl border p-6 text-[14px]">
          <p className="text-aomi-muted mb-5 text-[13px]">Working · 17 steps</p>
          <h2 className="font-medium">Simulate transaction</h2>
          <div className="text-aomi-muted mt-3 flex flex-wrap gap-2 text-[12px]">
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Base
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              2 txs
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              226,611 gas
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Success
            </span>
          </div>
          <p className="text-aomi-muted mt-5 max-w-[760px] leading-6">
            Your Base wallet has 304.077784 USDC. I verified the exact batch:
            approve 100 USDC to Aave, then supply 100 USDC. Simulation passed;
            the supply moves 100 USDC from your wallet into Aave and mints the
            corresponding aUSDC position.
          </p>
          <h2 className="mt-6 font-medium">Commit transactions</h2>
          <div className="text-aomi-muted mt-3 flex gap-2 text-[12px]">
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Base
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              2 txs
            </span>
            <span className="border-aomi-border rounded-full border px-3 py-1.5">
              Pending approval
            </span>
          </div>
        </article>
      </section>
      <section
        id="sidebar-fixture-mount"
        className="relative h-[825px]"
        aria-label="Sidebar fixture mount"
      >
        <ActivitySidebar />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
