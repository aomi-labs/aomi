"use client";

import type { AomiPackage } from "@aomi-labs/client";
import { AppIdentityIcon } from "@/icons/app-identity-icon";
import { brandId } from "./model";

interface PackageIconProps {
  row: AomiPackage;
  size?: "row" | "detail";
}

export function PackageIcon({ row, size = "row" }: PackageIconProps) {
  return (
    <AppIdentityIcon
      brandId={brandId(row)}
      name={row.display_name}
      size={size}
    />
  );
}
