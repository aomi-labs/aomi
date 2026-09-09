"use client";

/**
 * Official wallet brand marks — synced from aomi-portal brands.tsx.
 * SVG paths mirror shadcn-registry wallet icons, rendered in each brand's color.
 */

import { Wallet as WalletIcon } from "lucide-react";
import { markup, type BrandProps } from "./brand-mark";

export const MetaMaskMark = markup(
  "0 0 142 136.878",
  '<path d="M132.682 132.192l-30.583-9.106-23.063 13.787-16.092-.007-23.077-13.78-30.569 9.106L0 100.801l9.299-34.839L0 36.507 9.299 0l47.766 28.538h27.85L132.682 0l9.299 36.507-9.299 29.455 9.299 34.839-9.299 31.391z" fill="currentColor" opacity=".2"/><path d="M9.305 0l47.767 28.558-1.899 19.599L9.305 0zm30.57 100.814 21.017 16.01-21.017 6.261v-22.271zm19.337-26.469-4.039-26.174L29.317 65.97l-.014-.007v.013l.08 18.321 10.485-9.951h19.344zm73.47-74.345L84.915 28.558l1.893 19.599L132.682 0zm-30.569 100.814-21.018 16.01 21.018 6.261v-22.271zm10.565-34.839h.007-.007v-.013l-.006.007-25.857-17.798-4.039 26.174h19.336l10.492 9.95.074-18.32z" fill="currentColor" opacity=".56"/><path d="M39.868 123.085 9.299 132.191 0 100.814h39.868v22.271zm19.337-48.747 5.839 37.84-8.093-21.04-27.581-6.843 10.491-9.956h19.344zm42.907 48.747 30.57 9.106 9.299-31.378h-39.869v22.272zm-19.336-48.747-5.839 37.84 8.092-21.04 27.583-6.843-10.498-9.956H82.776z" fill="currentColor" opacity=".42"/><path d="M0 100.801l9.299-34.839h19.997l.073 18.327 27.584 6.843 8.092 21.039-4.16 4.633-21.017-16.01H0zm141.981 0-9.299-34.839h-19.998l-.073 18.327-27.582 6.843-8.093 21.039 4.159 4.633 21.018-16.01h39.868zM84.915 28.538h-27.85l-1.891 19.599 9.872 64.013h11.891l9.878-64.013z" fill="currentColor" opacity=".3"/><path d="M9.299 0 0 36.507l9.299 29.455h19.997l25.87-17.804L9.299 0zm44.127 81.938h-9.059l-4.932 4.835 17.524 4.344-3.533-9.186v.007zM132.682 0l9.299 36.507-9.299 29.455h-19.998L86.815 48.158 132.682 0zM88.568 81.938h9.072l4.932 4.841-17.544 4.353 3.54-9.201v.007zm-9.539 42.447 2.067-7.567-4.16-4.633h-11.9l-4.159 4.633 2.066 7.567" fill="currentColor" opacity=".9"/><path d="M79.029 124.384v12.495H62.945v-12.495h16.084z" fill="currentColor" opacity=".5"/><path d="M39.875 123.072l23.083 13.8v-12.495l-2.067-7.566-21.016 6.261zm62.238 0-23.084 13.8v-12.495l2.067-7.566 21.017 6.261z" fill="currentColor" opacity=".72"/>',
  "#F6851B",
);

export const RabbyMark = markup(
  "0 0 161 160",
  '<path d="M148.047 88.617c5.401-12.11-21.298-45.944-46.804-60.04-16.077-10.919-32.83-9.419-36.223-4.625-7.446 10.523 24.657 19.439 46.126 29.843-4.615 2.012-8.964 5.623-11.522 10.24-8.004-8.771-25.571-16.324-46.185-10.24-13.891 4.1-25.435 13.766-29.897 28.366a8.69 8.69 0 0 0-3.548-.753c-4.829 0-8.744 3.93-8.744 8.777s3.915 8.778 8.744 8.778c.895 0 3.694-.603 3.694-.603l44.725.325c-17.886 28.483-32.022 32.646-32.022 37.581s13.525 3.597 18.604 1.758c24.311-8.805 50.422-36.247 54.902-44.146 18.816 2.356 34.629 2.635 38.15-5.261z" fill="currentColor"/><path d="M64.484 29.359c1.511-3.021 11.72-3.358 25.584 3.197 10.176 4.811 21.013 15.552 21.641 18.215.273 1.158.433 2.634-.562 3.027l-.004-.002.003-.001c-17.702-8.579-42.632-16.146-46.662-24.436z" fill="currentColor" opacity=".45"/><path d="M58.669 71.877c14.846 0 21.235 4.823 26.325 13.882 3.626 6.455 2.821 16.666-1.019 23.563 3.6.895 6.767 1.883 9.57 2.959-4.547 4.25-9.751 8.663-15.286 12.71-7.536-1.93-14.384-3.763-24.767-6.434 4.438-4.861 9.509-11.252 14.922-19.872l-40.145-.292a48.64 48.64 0 0 1-.14-5.333c.391-18.421 22.375-21.183 30.54-21.183z" fill="currentColor" opacity=".3"/><path d="M23.006 96.5c1.64 13.994 9.563 19.478 25.753 21.101 16.19 1.623 25.477.535 37.841 1.664 10.327.943 19.547 6.225 22.967 4.399 3.079-1.642 1.356-7.577-2.763-11.385-5.339-4.936-12.729-8.368-25.731-9.585 2.591-7.122 1.865-17.108-2.16-22.541-5.819-7.855-16.56-11.406-30.154-9.855C34.557 71.919 20.948 78.938 23.006 96.5z" fill="currentColor" opacity=".62"/>',
  "#8697FF",
);

export const WalletConnectMark = markup(
  "0 0 480 332",
  '<path d="m126.613 93.9842c62.622-61.3123 164.152-61.3123 226.775 0l7.536 7.3788c3.131 3.066 3.131 8.036 0 11.102l-25.781 25.242c-1.566 1.533-4.104 1.533-5.67 0l-10.371-10.154c-43.687-42.7734-114.517-42.7734-158.204 0l-11.107 10.874c-1.565 1.533-4.103 1.533-5.669 0l-25.781-25.242c-3.132-3.066-3.132-8.036 0-11.102zm280.093 52.2038 22.946 22.465c3.131 3.066 3.131 8.036 0 11.102l-103.463 101.301c-3.131 3.065-8.208 3.065-11.339 0l-73.432-71.896c-.783-.767-2.052-.767-2.835 0l-73.43 71.896c-3.131 3.065-8.208 3.065-11.339 0l-103.4657-101.302c-3.1311-3.066-3.1311-8.036 0-11.102l22.9456-22.466c3.1311-3.065 8.2077-3.065 11.3388 0l73.4333 71.897c.782.767 2.051.767 2.834 0l73.429-71.897c3.131-3.065 8.208-3.065 11.339 0l73.433 71.897c.783.767 2.052.767 2.835 0l73.431-71.895c3.132-3.066 8.208-3.066 11.339 0z" fill="currentColor"/>',
  "#3B99FC",
);

export const RainbowMark = markup(
  "0 0 80 80",
  '<path d="M0 18h6c30.928 0 56 25.072 56 56v6h12a6 6 0 0 0 6-6C80 33.131 46.869 0 6 0a6 6 0 0 0-6 6v12z" fill="currentColor"/><path d="M64 74h16a6 6 0 0 1-6 6H64v-6z" fill="currentColor" opacity=".82"/><path d="M6 0v16H0V6a6 6 0 0 1 6-6z" fill="currentColor" opacity=".82"/><path d="M0 16h6c32.033 0 58 25.968 58 58v6H46v-6c0-22.091-17.909-40-40-40H0V16z" fill="currentColor" opacity=".64"/><path d="M48 74h16v6H48v-6z" fill="currentColor" opacity=".52"/><path d="M0 32V16h6v16H0z" fill="currentColor" opacity=".52"/><path d="M0 42a6 6 0 0 0 6 6c14.359 0 26 11.641 26 26a6 6 0 0 0 6 6h10v-6C48 50.804 29.196 32 6 32H0v10z" fill="currentColor" opacity=".38"/><path d="M32 74h16v6H38a6 6 0 0 1-6-6z" fill="currentColor" opacity=".34"/><path d="M6 48a6 6 0 0 1-6-6V32h6v16z" fill="currentColor" opacity=".34"/>',
  "#174299",
);

export const ParaMark = markup(
  "-1 -1 27 26",
  '<path d="M16.7506 0.114342H7.01716V13.267C7.01716 14.2305 6.24304 15.0128 5.28576 15.0128H0V23.8289H8.74337V18.4992C8.74337 17.5357 9.51749 16.7534 10.4748 16.7534H16.8854C21.4904 16.7534 25.2124 12.9517 25.1363 8.29101C25.0603 3.63032 21.2761 0.114342 16.7506 0.114342Z" fill="currentColor"/>',
  "#FF4E1B",
);

export const PrivyMark = markup(
  "0 0 24 24",
  '<rect x="4" y="4" width="7" height="7" rx="2" fill="currentColor"/><rect x="13" y="4" width="7" height="7" rx="2" fill="currentColor" opacity="0.88"/><rect x="4" y="13" width="7" height="7" rx="2" fill="currentColor" opacity="0.88"/>',
  "#FF775F",
);

export function PhantomMark({ size = 16, ...props }: BrandProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
      {...props}
    >
      <circle cx="64" cy="64" r="64" fill="#AB9FF2" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M55.6416 82.1477C50.8744 89.4525 42.8862 98.6966 32.2568 98.6966C27.232 98.6966 22.4004 96.628 22.4004 87.6424C22.4004 64.7584 53.6445 29.3335 82.6339 29.3335C99.1257 29.3335 105.697 40.7755 105.697 53.7689C105.697 70.4471 94.8739 89.5171 84.1156 89.5171C80.7013 89.5171 79.0264 87.6424 79.0264 84.6688C79.0264 83.8931 79.1552 83.0527 79.4129 82.1477C75.7409 88.4182 68.6546 94.2361 62.0192 94.2361C57.1877 94.2361 54.7397 91.1979 54.7397 86.9314C54.7397 85.3799 55.0618 83.7638 55.6416 82.1477ZM80.6133 53.3182C80.6133 57.1044 78.3795 58.9975 75.8806 58.9975C73.3438 58.9975 71.1479 57.1044 71.1479 53.3182C71.1479 49.532 73.3438 47.6389 75.8806 47.6389C78.3795 47.6389 80.6133 49.532 80.6133 53.3182ZM94.8102 53.3184C94.8102 57.1046 92.5763 58.9977 90.0775 58.9977C87.5407 58.9977 85.3447 57.1046 85.3447 53.3184C85.3447 49.5323 87.5407 47.6392 90.0775 47.6392C92.5763 47.6392 94.8102 49.5323 94.8102 53.3184Z"
        fill="#FFFDF8"
      />
    </svg>
  );
}

export function CoinbaseMark({ size = 16, ...props }: BrandProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
      {...props}
    >
      <circle cx="12" cy="12" r="12" fill="#0052FF" />
      <rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="#FFFFFF" />
    </svg>
  );
}

export function BackpackMark({ size = 16, ...props }: BrandProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
      {...props}
    >
      <rect width="32" height="32" rx="8" fill="#E33E3F" />
      <path
        d="M11 10.5h10c1.1 0 2 .9 2 2v10.2c0 1.1-.9 2-2 2H11c-1.1 0-2-.9-2-2V12.5c0-1.1.9-2 2-2Z"
        fill="#FFFFFF"
      />
      <path
        d="M13 10.5V9.2c0-1.5 1.2-2.7 2.7-2.7h.6c1.5 0 2.7 1.2 2.7 2.7v1.3"
        stroke="#FFFFFF"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="13.2" y="14.2" width="5.6" height="3.2" rx="1" fill="#E33E3F" />
      <path
        d="M10 18.8h12"
        stroke="#E33E3F"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const WALLET_MARKS: Record<string, (p: { size?: number }) => React.ReactNode> =
  {
    metamask: MetaMaskMark,
    rabby: RabbyMark,
    coinbase: CoinbaseMark,
    walletconnect: WalletConnectMark,
    rainbow: RainbowMark,
    phantom: PhantomMark,
    backpack: BackpackMark,
    para: ParaMark,
    privy: PrivyMark,
  };

/** Resolve persisted labels such as "Rabby 1" to their canonical brand. */
export function resolveWalletBrandKey(value: string): string | null {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key.includes("metamask")) return "metamask";
  if (key.includes("rabby")) return "rabby";
  if (key.includes("coinbase")) return "coinbase";
  if (key.includes("walletconnect")) return "walletconnect";
  if (key.includes("rainbow")) return "rainbow";
  if (key.includes("phantom")) return "phantom";
  if (key.includes("backpack")) return "backpack";
  if (key.includes("para")) return "para";
  if (key.includes("privy")) return "privy";
  return null;
}

/** Wallet id or name → brand mark (null when unknown). */
export function WalletMark({
  name,
  size = 16,
}: {
  name: string;
  size?: number;
}) {
  const key = resolveWalletBrandKey(name);
  const Mark = key ? WALLET_MARKS[key] : undefined;
  return Mark ? <>{Mark({ size })}</> : null;
}

export function WalletProviderAvatar({
  markKey,
  size = 18,
}: {
  markKey: string | null;
  size?: number;
}) {
  const brand = markKey ? resolveWalletBrandKey(markKey) : null;
  const mark = brand ? <WalletMark name={brand} size={size} /> : null;

  return (
    <span
      className="bg-aomi-surface-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      data-wallet-brand={brand ?? undefined}
      title={brand ? `${brand} wallet` : undefined}
    >
      {mark ?? <WalletIcon size={16} className="text-aomi-muted" />}
    </span>
  );
}
