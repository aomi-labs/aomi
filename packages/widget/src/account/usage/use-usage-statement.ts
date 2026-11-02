"use client";

import { useCallback, useMemo, useState } from "react";
import { useDisplayQuery } from "@aomi-labs/react";
import { useAccountCredits } from "@/account/use-account-credits";
import { creditAllowanceFromPosition } from "@/account/account-overview";
import { explainAccountError } from "@/account/account-api";
import { useShellAomi } from "@/account/transport";
import { useAomiWalletKit } from "@/wallet/context";
import { packageCatalogQuery } from "@/library/use-package-catalog";
import {
  applicationNamesFrom,
  buildMonthlyStatement,
  currentMonthKey,
  fetchStatementCharges,
  recentMonthKeys,
} from "./statement-api";

export type StatementStatus = "loading" | "ready" | "error";
export type AllowanceStatus = "idle" | "loading" | "ready" | "error";

const NO_NAMES: ReadonlyMap<number, string> = new Map();

/**
 * Real statement months, held in the shared display cache per account and
 * month, so reopening Settings or the full statement reuses them. App names
 * come from the shared account-apps read and never hold back the totals. The
 * allowance meter comes from the current account credit balance, so past
 * months hide it rather than showing today's value.
 */
export function useUsageStatement(monthCount = 6) {
  const aomi = useShellAomi();
  const accountUserId = useAomiWalletKit().accountUser?.id;
  const monthKeys = useMemo(() => recentMonthKeys(monthCount), [monthCount]);
  const [selectedKey, setSelectedKey] = useState(() => currentMonthKey());
  const credits = useAccountCredits(true);

  const charges = useDisplayQuery({
    resource: "usage",
    parameters: ["statement", accountUserId ?? "", selectedKey],
    fetcher: (signal) =>
      fetchStatementCharges(selectedKey, aomi.account, signal),
  });
  const needsNames = Boolean(
    accountUserId &&
    charges.data?.some((charge) => charge.applicationId !== null),
  );
  const apps = useDisplayQuery({
    ...packageCatalogQuery(aomi, accountUserId),
    enabled: needsNames,
  });
  const names = useMemo(
    () => (apps.data ? applicationNamesFrom(apps.data) : NO_NAMES),
    [apps.data],
  );

  const allowanceStatus: AllowanceStatus = credits.isPending
    ? "loading"
    : credits.error
      ? "error"
      : "ready";
  const creditAllowance = useMemo(
    () => creditAllowanceFromPosition(credits.data) ?? { included: 0, used: 0 },
    [credits.data],
  );

  const month = useMemo(() => {
    if (!charges.data) return null;
    const statement = buildMonthlyStatement(selectedKey, charges.data, names);
    return {
      ...statement,
      payment: { ...statement.payment, allowanceCredits: creditAllowance },
    };
  }, [charges.data, creditAllowance, names, selectedKey]);

  const selectMonth = useCallback((monthKey: string) => {
    setSelectedKey(monthKey);
  }, []);

  return {
    status: (charges.data
      ? "ready"
      : charges.error
        ? "error"
        : "loading") as StatementStatus,
    error: charges.error ? explainAccountError(charges.error) : undefined,
    monthKeys,
    selectedKey,
    selectMonth,
    month,
    isCurrentMonth: selectedKey === currentMonthKey(),
    allowanceStatus,
    allowanceError: credits.error
      ? explainAccountError(credits.error)
      : undefined,
    retryAllowance: () => void credits.refetch(),
    retry: () => void charges.refetch(),
  };
}
