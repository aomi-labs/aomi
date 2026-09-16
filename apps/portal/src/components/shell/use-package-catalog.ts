"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAppCatalog } from "./packages-api";
import {
  explainPackageLoadError,
  toCatalogPackage,
  type CatalogPackage,
} from "./packages-catalog";

export function usePackageCatalog() {
  const [catalog, setCatalog] = useState<CatalogPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setError(null);

    fetchAppCatalog()
      .then((apps) => {
        if (!cancelled) setCatalog(apps.map(toCatalogPackage));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(explainPackageLoadError(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  const retry = useCallback(() => {
    setRequest((current) => current + 1);
  }, []);

  return { catalog, error, retry };
}
