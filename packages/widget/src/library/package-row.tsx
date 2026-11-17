"use client";

import type { AomiPackage } from "@aomi-labs/client";
import { AgentIdentityIcon } from "@/icons/agent-identity-icon";
import { brandId } from "./model";

interface PackageIconProps {
  row: AomiPackage;
  size?: "row" | "detail";
}

export function PackageIcon({ row, size = "row" }: PackageIconProps) {
  return (
    <AgentIdentityIcon
      brandId={brandId(row)}
      name={row.display_name}
      imageUrl={row.icon_url}
      size={size}
    />
  );
}
