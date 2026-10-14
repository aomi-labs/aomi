"use client";

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import { MARKETING_ROOT } from "../site";
import styles from "./pricing.module.css";

type Audience = "user" | "enterprise";

type Plan = {
  label: string;
  price: string;
  unit: string;
  body: string;
  points: readonly string[];
  cta: { label: string; href: string; external?: boolean };
  featured?: boolean;
};

const PLANS: Record<Audience, readonly Plan[]> = {
  user: [
    {
      label: "Included",
      price: "$0",
      unit: "to start",
      body: "Every account starts with an allowance. Chat, plan, and simulate transactions without paying anything.",
      points: [
        "Full agent, all supported chains",
        "Unlimited simulations",
        "No card required",
      ],
      cta: {
        label: "Open Aomi",
        href: "https://chat.aomi.dev",
        external: true,
      },
    },
    {
      label: "Pay as you go",
      price: "$0.01",
      unit: "per credit",
      body: "When the allowance runs out, you pay for the work a turn actually does — the model it used and any priced tools it called.",
      points: [
        "A typical turn costs a few cents",
        "Failed or blocked calls are never charged",
        "Top up by card or stablecoin",
      ],
      cta: { label: "See what a turn costs", href: "#example" },
      featured: true,
    },
    {
      label: "Bring your own key",
      price: "$0",
      unit: "for model usage",
      body: "Connect your own model provider key and the provider bills you directly. Aomi charges nothing for the model.",
      points: [
        "Your key, your provider account",
        "No Aomi credits consumed",
        "Switch back at any time",
      ],
      cta: { label: "How BYOK works", href: "#details" },
    },
  ],
  enterprise: [
    {
      label: "Hosting",
      price: "$10",
      unit: "per app · per month",
      body: "A flat fee to run your app on Aomi's hosted runtime — sessions, orchestration, deployment, and execution included.",
      points: [
        "Unlimited turns",
        "Every surface: widget, Telegram, API, Portal",
        "No per-seat or per-user pricing",
      ],
      cta: {
        label: "Start building",
        href: "https://build.aomi.dev",
        external: true,
      },
    },
    {
      label: "Model usage",
      price: "+10%",
      unit: "on model cost",
      body: "Use Aomi's managed provider keys and pay base cost plus ten percent — or bring your own key and pay us nothing for the model.",
      points: [
        "Published per-model rates",
        "$0 with your own provider key",
        "Billed on your statement, not to your users",
      ],
      cta: { label: "See model rates", href: "#details" },
      featured: true,
    },
    {
      label: "Revenue share",
      price: "10 / 30%",
      unit: "of the fees you set",
      body: "Charge your users for tool calls or take a cut of value your app moves. You set the prices and keep the rest.",
      points: [
        "10% of the tool fees you charge",
        "30% of the onchain outcome fees you take",
        "Nothing owed when you charge nothing",
      ],
      cta: { label: "Talk to us", href: `${MARKETING_ROOT}/contact` },
    },
  ],
};

const NEVER_CHARGED = [
  "Turns that fail or get interrupted",
  "Tool calls blocked by policy",
  "Simulations, quotes, and previews",
  "Gas — you pay the network directly, or your app sponsors it",
] as const;

export function PricingSwitch() {
  const [audience, setAudience] = useState<Audience>("user");
  const plans = PLANS[audience];

  return (
    <>
      <div className={styles.switchRow}>
        <div className={styles.switch} role="tablist" aria-label="Audience">
          {(["user", "enterprise"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={audience === id}
              className={audience === id ? styles.switchActive : ""}
              onClick={() => setAudience(id)}
            >
              {id === "user"
                ? "For retail users"
                : "For enterprise & developers"}
            </button>
          ))}
        </div>
        <p className={styles.switchNote}>
          {audience === "user"
            ? "You use Aomi, or an app built on it."
            : "You build on Aomi and charge your own customers."}
        </p>
      </div>

      <div className={styles.planGrid} key={audience}>
        {plans.map((plan) => (
          <article
            key={plan.label}
            className={plan.featured ? styles.planFeatured : ""}
          >
            <p className={styles.planLabel}>{plan.label}</p>
            <p className={styles.planPrice}>
              {plan.price}
              <span>{plan.unit}</span>
            </p>
            {plan.cta.external ? (
              <a
                href={plan.cta.href}
                target="_blank"
                rel="noreferrer"
                className={styles.planCta}
              >
                {plan.cta.label}
                <ArrowUpRight aria-hidden />
              </a>
            ) : (
              <Link
                {...(plan.cta.href.startsWith("#")
                  ? { to: ".", hash: plan.cta.href.slice(1) }
                  : { to: plan.cta.href })}
                className={styles.planCta}
              >
                {plan.cta.label}
                <ArrowRight aria-hidden />
              </Link>
            )}
            <p className={styles.planBody}>{plan.body}</p>
            <ul className={styles.planPoints}>
              {plan.points.map((point) => (
                <li key={point}>
                  <Check aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {audience === "user" ? (
        <div className={styles.addOn}>
          <div>
            <p className={styles.eyebrow}>When the agent moves money</p>
            <h3>Some apps take a small cut of what you move.</h3>
            <p>
              If an app charges a fee on a swap or transfer, it is shown in the
              confirmation before you sign, taken in the token you are moving,
              and only ever charged when the transaction succeeds. Aomi never
              takes it from your wallet — it rides inside your own transaction.
            </p>
          </div>
          <ul className={styles.neverList}>
            <p>You are never charged for</p>
            {NEVER_CHARGED.map((item) => (
              <li key={item}>
                <X aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className={styles.addOn}>
          <div>
            <p className={styles.eyebrow}>What you can charge for</p>
            <h3>Your prices, your product.</h3>
            <p>
              Put a flat price on any tool your app exposes, and take a
              percentage of value your app moves onchain. Both are declared in
              your app&apos;s config, collected automatically, and paid to the
              account you nominate — Aomi&apos;s share comes out of what you
              charge, never as a second charge to your customer.
            </p>
          </div>
          <ul className={styles.neverList}>
            <p>You are never charged for</p>
            <li>
              <X aria-hidden />
              Turns your users pay for themselves
            </li>
            <li>
              <X aria-hidden />
              Model usage on your own provider key
            </li>
            <li>
              <X aria-hidden />
              Failed turns, blocked tools, or simulations
            </li>
            <li>
              <X aria-hidden />
              Seats, users, or API calls
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
