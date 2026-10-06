"use client";

import type { CSSProperties } from "react";
import { WalletIcon } from "lucide-react";
import { cn } from "@aomi-labs/react";
import { getWalletIcon, getWalletIconBrand } from "../icons";

/**
 * Single source of truth for how a wallet brand mark is drawn — used by both the
 * wallet picker rows and the connect-bar trigger so the logos (colour, sizing,
 * Phantom's slightly larger art, and the fallbacks) always match.
 *
 * `size` is the slot edge in px; the mark scales proportionally from it. Pass
 * `className` to restyle the slot (e.g. a circular, ring-outlined avatar).
 */
const DEFAULT_SLOT = 36;
const BRAND_RATIO = 24 / 36;
const PHANTOM_RATIO = 27.6 / 36;
// Para's mark reads heavier than the others at the shared ratio, so render it
// 15% smaller to sit visually level with the rest.
const PARA_RATIO = (24 * 0.85) / 36;
const FALLBACK_RATIO = 16 / 36;

const BRAND_COLORS: Record<string, string> = {
  base: "#0052ff",
  coinbase: "#0052ff",
  metamask: "#f6851b",
  para: "#ff4e1b",
  phantom: "#ab9ff2",
  privy: "#ff775f",
  rabby: "#8697ff",
  rainbow: "#174299",
  walletconnect: "#3b99fc",
};

export function WalletIconSlot({
  iconUrl,
  id,
  label,
  provider,
  size = DEFAULT_SLOT,
  className,
}: {
  iconUrl?: string;
  id?: string;
  label: string;
  provider?: string;
  size?: number;
  className?: string;
}) {
  const key = `${provider ?? ""} ${id ?? ""} ${label}`;
  const brandKey = provider ?? key;
  const BrandIcon = getWalletIcon(brandKey) ?? getWalletIcon(key);
  const brand = getWalletIconBrand(brandKey) ?? getWalletIconBrand(key);
  const lowerKey = key.toLowerCase();
  const isPhantom = lowerKey.includes("phantom");
  const isPara = lowerKey.includes("para");
  const slotStyle: CSSProperties = { width: size, height: size };

  if (BrandIcon) {
    const mark =
      size * (isPhantom ? PHANTOM_RATIO : isPara ? PARA_RATIO : BRAND_RATIO);
    return (
      <span
        className={cn(
          "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-xl",
          className,
        )}
        style={{ ...slotStyle, color: brand ? BRAND_COLORS[brand] : undefined }}
        aria-hidden="true"
        title={label}
        data-wallet-brand={brand}
      >
        <BrandIcon style={{ width: mark, height: mark }} />
      </span>
    );
  }

  if (iconUrl) {
    const mark = size * BRAND_RATIO;
    return (
      <span
        className={cn(
          "bg-muted/50 flex shrink-0 items-center justify-center overflow-hidden rounded-xl",
          className,
        )}
        style={slotStyle}
      >
        <img
          src={iconUrl}
          alt=""
          className="object-contain"
          style={{ width: mark, height: mark }}
        />
      </span>
    );
  }

  const mark = size * FALLBACK_RATIO;
  return (
    <span
      className={cn(
        "bg-muted/50 text-muted-foreground flex shrink-0 items-center justify-center rounded-xl",
        className,
      )}
      style={slotStyle}
      aria-hidden="true"
      title={label}
    >
      <WalletIcon style={{ width: mark, height: mark }} />
    </span>
  );
}
