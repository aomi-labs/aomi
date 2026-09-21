"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { explainAccountError } from "../account/account-api";
import { useShellTransport } from "../../transport";
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
export type AllowanceStatus = "idle" | "loading" | "ready" | "error";

/**
 * Real statement months, fetched per month key on demand and cached for the
 * session. The current month loads immediately; the picker's other months
 * load when selected. The allowance meter comes from the profile's embedded
 * monthly credit position, so it's only exact for the current month — for
 * past months the credits meter is hidden rather than shown wrong.
 */
export function useUsageStatement(monthCount = 6) {
  const { json: request } = useShellTransport();
  const monthKeys = useMemo(() => recentMonthKeys(monthCount), [monthCount]);
  const [selectedKey, setSelectedKey] = useState(() => currentMonthKey());
  const [wireMonths, setWireMonths] = useState<
    Record<string, WireModelStatement>
  >({});
  const [status, setStatus] = useState<StatementStatus>("loading");
  const [error, setError] = useState<string | undefined>();
  const [allowanceStatus, setAllowanceStatus] =
    useState<AllowanceStatus>("idle");
  const [allowanceError, setAllowanceError] = useState<string | undefined>();
  const [creditAllowance, setCreditAllowance] = useState({
    included: 0,
    used: 0,
  });
  const inflight = useRef<Set<string>>(new Set());
  const allowanceInflight = useRef(false);

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

  const loadAllowance = useCallback(async () => {
    if (allowanceInflight.current) return;
    allowanceInflight.current = true;
    setAllowanceStatus("loading");
    try {
      setCreditAllowance(await fetchCreditAllowance(request));
      setAllowanceStatus("ready");
      setAllowanceError(undefined);
    } catch (cause) {
      setAllowanceStatus("error");
      setAllowanceError(explainAccountError(cause));
    } finally {
      allowanceInflight.current = false;
    }
  }, [request]);

  const loadStatement = useCallback(
    async (monthKey: string) => {
      if (inflight.current.has(monthKey)) return;
      inflight.current.add(monthKey);
      setStatus("loading");
      if (monthKey === currentMonthKey()) void loadAllowance();
      try {
        const wire = await fetchModelStatement(monthKey, request);
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
    },
    [loadAllowance, request],
  );

  useEffect(() => {
    if (!wireMonths[selectedKey]) {
      void loadStatement(selectedKey);
    } else {
      setStatus("ready");
    }
  }, [selectedKey, wireMonths, loadStatement]);

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
    allowanceStatus,
    allowanceError,
    retryAllowance: () => void loadAllowance(),
    retry: () => void loadStatement(selectedKey),
  };
}
