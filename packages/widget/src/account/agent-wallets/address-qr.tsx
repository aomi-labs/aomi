"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/** A deposit QR of `address`, drawn in the theme's ink on the card's surface. */
export function AddressQr({ address }: { address: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(address, { ecc: "M", border: 2 });
    let path = "";
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size, path };
  }, [address]);
  return (
    <svg
      role="img"
      aria-label={`QR code for ${address}`}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="border-aomi-border bg-aomi-raised text-aomi-fg size-[168px] rounded-xl border"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
