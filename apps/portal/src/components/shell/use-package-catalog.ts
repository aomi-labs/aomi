"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAppCatalog } from "./packages-api";
import {
  explainPackageLoadError,
  toCatalogPackage,
  type CatalogPackage,
} from "./packages-catalog";

export function usePackageCatalog(accountUserId?: string) {
  const [catalog, setCatalog] = useState<{
    accountUserId?: string;
    entries: CatalogPackage[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setError(null);

    fetchAppCatalog(accountUserId)
      .then((apps) => {
        if (!cancelled)
          setCatalog({ accountUserId, entries: apps.map(toCatalogPackage) });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(explainPackageLoadError(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [request, accountUserId]);

  const retry = useCallback(() => {
    setRequest((current) => current + 1);
  }, []);

  return {
    catalog:
      catalog && catalog.accountUserId === accountUserId
        ? catalog.entries
        : null,
    error,
    retry,
  };
}
