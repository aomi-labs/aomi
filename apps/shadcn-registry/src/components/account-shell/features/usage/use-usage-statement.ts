"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { explainAccountError } from "../account/account-api";
import { useShellTransport } from "../../transport";
import { useCreditAllowance } from "../../lib/use-credit-allowance";
import type { MonthlyStatement } from "./types";
import {
  currentMonthKey,
  fetchMonthlyStatement,
  recentMonthKeys,
} from "./statement-api";

export type StatementStatus = "loading" | "ready" | "error";
export type AllowanceStatus = "idle" | "loading" | "ready" | "error";

/**
 * Real statement months, fetched per month key on demand and cached for the
 * session. The current month loads immediately; the picker's other months
 * load when selected. The allowance meter comes from the current account
 * credit position, so past months hide it rather than showing today's value.
 */
export function useUsageStatement(monthCount = 6) {
  const { json: request } = useShellTransport();
  const monthKeys = useMemo(() => recentMonthKeys(monthCount), [monthCount]);
  const [selectedKey, setSelectedKey] = useState(() => currentMonthKey());
  const [statements, setStatements] = useState<
    Record<string, MonthlyStatement>
  >({});
  const [status, setStatus] = useState<StatementStatus>("loading");
  const [error, setError] = useState<string | undefined>();
  const allowance = useCreditAllowance();
  const creditAllowance = useMemo(
    () => ({
      included: allowance.data?.included ?? 0,
      used: allowance.data?.used ?? 0,
    }),
    [allowance.data],
  );
  const inflight = useRef<Set<string>>(new Set());

  const month = useMemo(() => {
    const statement = statements[selectedKey];
    return statement
      ? {
          ...statement,
          payment: {
            ...statement.payment,
            allowanceCredits: creditAllowance,
          },
        }
      : null;
  }, [creditAllowance, selectedKey, statements]);

  const loadStatement = useCallback(
    async (monthKey: string) => {
      if (inflight.current.has(monthKey)) return;
      inflight.current.add(monthKey);
      setStatus("loading");
      try {
        const statement = await fetchMonthlyStatement(monthKey, request);
        setStatements((cache) => ({
          ...cache,
          [monthKey]: statement,
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
    [request],
  );

  useEffect(() => {
    if (!statements[selectedKey]) {
      void loadStatement(selectedKey);
    } else {
      setStatus("ready");
    }
  }, [selectedKey, statements, loadStatement]);

  const selectMonth = useCallback((monthKey: string) => {
    setSelectedKey(monthKey);
  }, []);

  return {
    status,
    error,
    monthKeys,
    selectedKey,
    selectMonth,
    month,
    isCurrentMonth: selectedKey === currentMonthKey(),
    allowanceStatus: allowance.status,
    allowanceAvailable: Boolean(allowance.data),
    allowanceError: allowance.error,
    retryAllowance: () => void allowance.refresh(),
    retry: () => void loadStatement(selectedKey),
  };
}
