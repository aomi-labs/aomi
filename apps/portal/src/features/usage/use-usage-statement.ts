"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { explainAccountError } from "@portal/features/account/account-api";
import type { MonthlyStatement } from "./types";
import {
  currentMonthKey,
  fetchModelStatement,
  fetchCreditAllowance,
  recentMonthKeys,
  toMonthlyStatement,
  type WireModelStatement,
} from "./statement-api";

export type StatementStatus = "loading" | "ready" | "error";

/**
 * Real statement months, fetched per month key on demand and cached for the
 * session. The current month loads immediately; the picker's other months
 * load when selected. The allowance meter comes from the profile's embedded
 * monthly credit position, so it's only exact for the current month — for
 * past months the credits meter is hidden rather than shown wrong.
 */
export function useUsageStatement(monthCount = 6) {
  const monthKeys = useMemo(() => recentMonthKeys(monthCount), [monthCount]);
  const [selectedKey, setSelectedKey] = useState(() => currentMonthKey());
  const [wireMonths, setWireMonths] = useState<
    Record<string, WireModelStatement>
  >({});
  const [status, setStatus] = useState<StatementStatus>("loading");
  const [error, setError] = useState<string | undefined>();
  const [creditAllowance, setCreditAllowance] = useState({
    included: 0,
    used: 0,
  });
  const inflight = useRef<Set<string>>(new Set());

  const allowance = creditAllowance;
  const months = useMemo<Record<string, MonthlyStatement>>(
    () =>
      Object.fromEntries(
        Object.entries(wireMonths).map(([monthKey, wire]) => [
          monthKey,
          toMonthlyStatement(wire, monthKey, allowance),
        ]),
      ),
    [allowance, wireMonths],
  );

  const load = useCallback(async (monthKey: string) => {
    if (inflight.current.has(monthKey)) return;
    inflight.current.add(monthKey);
    setStatus("loading");
    try {
      const [wire, credits] = await Promise.all([
        fetchModelStatement(monthKey),
        monthKey === currentMonthKey()
          ? fetchCreditAllowance()
          : Promise.resolve(null),
      ]);
      if (credits) setCreditAllowance(credits);
      setWireMonths((cache) => ({
        ...cache,
        [monthKey]: wire,
      }));
      setStatus("ready");
      setError(undefined);
    } catch (cause) {
      setStatus("error");
      setError(explainAccountError(cause));
    } finally {
      inflight.current.delete(monthKey);
    }
  }, []);

  useEffect(() => {
    if (!wireMonths[selectedKey]) {
      void load(selectedKey);
    } else {
      setStatus("ready");
    }
  }, [selectedKey, wireMonths, load]);

  const selectMonth = useCallback((monthKey: string) => {
    setSelectedKey(monthKey);
  }, []);

  return {
    status,
    error,
    monthKeys,
    selectedKey,
    selectMonth,
    month: months[selectedKey] ?? null,
    isCurrentMonth: selectedKey === currentMonthKey(),
    retry: () => void load(selectedKey),
  };
}
