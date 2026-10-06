"use client";

import { AppIdentityIcon } from "@/icons/app-identity-icon";
import type { CatalogPackage } from "./packages-catalog";

interface PackageIconProps {
  app: CatalogPackage;
  size?: "small" | "large" | "detail";
}

export function PackageIcon({ app, size = "large" }: PackageIconProps) {
  return (
    <AppIdentityIcon
      brandId={app.brandId}
      name={app.name}
      abbr={app.abbr}
      size={size === "detail" ? "detail" : "row"}
    />
  );
}
