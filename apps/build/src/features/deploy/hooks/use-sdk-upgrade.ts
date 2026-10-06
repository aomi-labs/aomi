"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProjectSdkUpgradeResult,
  ProjectSdkUpgradeStatusResult,
} from "@aomi-labs/deploy";

/**
 * Lifecycle of one SDK upgrade, from the builder's side:
 *
 *   idle → confirm → opening → pr-open → merged → (redeploy, tracked by
 *   `useProjectDetail.deployFlow`) → live
 *
 * with two terminal exits: `manual` (Cargo.lock must be regenerated locally)
 * and `error`. The backend endpoint is idempotent — it reuses the
 * `aomi/sdk-<version>` branch and any open PR — which is what makes the
 * merge poll safe: re-calling it while the PR is open changes nothing, and
 * once the PR merges the repo head satisfies the requirement so the same
 * call answers `current`.
 */
export type SdkUpgradeState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "opening" }
  | { phase: "pr-open"; prUrl: string; prNumber: number; checking: boolean }
  | { phase: "merged"; alreadyCurrent: boolean }
  | { phase: "manual"; reason: string; command: string }
  | { phase: "error"; message: string };

/** Re-check cadence while a PR is open and the tab is visible. */
const MERGE_POLL_MS = 45_000;
const SKIP_CONFIRM_KEY = "aomi-build:sdk-upgrade-skip-confirm";
const railKey = (projectId: number) => `aomi-build:sdk-upgrade:${projectId}`;

function readStoredPr(
  projectId: number | null,
): { prUrl: string; prNumber: number } | null {
  if (projectId === null || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(railKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { prUrl?: unknown; prNumber?: unknown };
    if (typeof parsed.prUrl !== "string" || typeof parsed.prNumber !== "number")
      return null;
    return { prUrl: parsed.prUrl, prNumber: parsed.prNumber };
  } catch {
    return null;
  }
}

function writeStoredPr(
  projectId: number | null,
  pr: { prUrl: string; prNumber: number } | null,
) {
  if (projectId === null || typeof window === "undefined") return;
  try {
    if (pr) window.localStorage.setItem(railKey(projectId), JSON.stringify(pr));
    else window.localStorage.removeItem(railKey(projectId));
  } catch {
    // Storage may be unavailable (private mode); the rail just won't survive reloads.
  }
}

export function skipUpgradeConfirm(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SKIP_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSdkUpgrade({
  projectId,
  upgrade,
  checkStatus,
  onAlreadyCurrent,
}: {
  projectId: number | null;
  /** The BFF call that opens/reuses the upgrade PR (idempotent server-side). */
  upgrade: () => Promise<ProjectSdkUpgradeResult>;
  /**
   * The cheap merge poll: one GitHub-backed read of the upgrade PR's state,
   * no repo tarball or branch refresh. Used by the recheck loop in place of
   * re-calling {@link upgrade}.
   */
  checkStatus: () => Promise<ProjectSdkUpgradeStatusResult>;
  /**
   * First-click shortcut: the repo already satisfies the required SDK, so
   * there is no PR to wait on — the caller kicks the redeploy directly.
   */
  onAlreadyCurrent?: () => void;
}) {
  const [state, setState] = useState<SdkUpgradeState>(() => {
    const stored = readStoredPr(projectId);
    return stored
      ? { phase: "pr-open", ...stored, checking: false }
      : { phase: "idle" };
  });
  const inFlight = useRef(false);
  const alreadyCurrentRef = useRef(onAlreadyCurrent);
  useEffect(() => {
    alreadyCurrentRef.current = onAlreadyCurrent;
  }, [onAlreadyCurrent]);

  // A different source means a different rail: reset from that source's storage.
  useEffect(() => {
    const stored = readStoredPr(projectId);
    setState(
      stored
        ? { phase: "pr-open", ...stored, checking: false }
        : { phase: "idle" },
    );
  }, [projectId]);

  const applyResult = useCallback(
    (result: ProjectSdkUpgradeResult, from: "open" | "recheck") => {
      if (result.status === "pull_request") {
        const pr = {
          prUrl: result.pullRequest.url,
          prNumber: result.pullRequest.number,
        };
        writeStoredPr(projectId, pr);
        setState({ phase: "pr-open", ...pr, checking: false });
        return;
      }
      if (result.status === "current") {
        writeStoredPr(projectId, null);
        const alreadyCurrent = from === "open";
        setState({ phase: "merged", alreadyCurrent });
        if (alreadyCurrent) alreadyCurrentRef.current?.();
        return;
      }
      writeStoredPr(projectId, null);
      setState({
        phase: "manual",
        reason: result.reason,
        command: result.command,
      });
    },
    [projectId],
  );

  const openPr = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ phase: "opening" });
    try {
      applyResult(await upgrade(), "open");
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "SDK upgrade failed",
      });
    } finally {
      inFlight.current = false;
    }
  }, [applyResult, upgrade]);

  const requestUpgrade = useCallback(() => {
    if (skipUpgradeConfirm()) void openPr();
    else setState({ phase: "confirm" });
  }, [openPr]);

  const confirm = useCallback(
    (skipNextTime: boolean) => {
      if (skipNextTime && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(SKIP_CONFIRM_KEY, "1");
        } catch {
          // Best-effort preference only.
        }
      }
      void openPr();
    },
    [openPr],
  );

  const cancel = useCallback(() => setState({ phase: "idle" }), []);

  /**
   * Poll the upgrade PR's merge state via the cheap status read. `merged` is
   * terminal (the repo head now satisfies the requirement); `open` keeps the
   * rail waiting; `closed`/`none` means the PR is gone, so reconcile through
   * the idempotent {@link upgrade} call, which reopens/recreates it.
   */
  const recheck = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((prev) =>
      prev.phase === "pr-open" ? { ...prev, checking: true } : prev,
    );
    try {
      const status = await checkStatus();
      if (status.status === "merged") {
        writeStoredPr(projectId, null);
        setState({ phase: "merged", alreadyCurrent: false });
      } else if (status.status === "open") {
        setState((prev) =>
          prev.phase === "pr-open" ? { ...prev, checking: false } : prev,
        );
      } else {
        applyResult(await upgrade(), "recheck");
      }
    } catch {
      // Transient failure — keep waiting on the PR; the next tick retries.
      setState((prev) =>
        prev.phase === "pr-open" ? { ...prev, checking: false } : prev,
      );
    } finally {
      inFlight.current = false;
    }
  }, [applyResult, checkStatus, upgrade, projectId]);

  const dismiss = useCallback(() => {
    writeStoredPr(projectId, null);
    setState({ phase: "idle" });
  }, [projectId]);

  // Merge poll: only while a PR is open and the page is visible.
  const prOpen = state.phase === "pr-open";
  useEffect(() => {
    if (!prOpen) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void recheck();
    }, MERGE_POLL_MS);
    return () => clearInterval(timer);
  }, [prOpen, recheck]);

  return { state, requestUpgrade, confirm, cancel, recheck, dismiss };
}
