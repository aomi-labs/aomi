"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAomiWalletKit } from "@aomi-labs/widget-lib";
import {
  githubAppInstallUrl,
  loadLaunch,
  saveLaunch,
  readGithubRedirect,
  withPath,
  withProgress,
  withPendingInstall,
  withRejectedInstall,
  GITHUB_REDIRECT_KEYS,
  type LaunchState,
  type LaunchProgress,
  type UserProject,
} from "@portal/features/launch";
import { OneshotWizard } from "./oneshot-wizard";

const PATH = "oneshot" as const;

export function Onboarding({
  hideWizardBack = false,
  knownSources = [],
  sessionInstallationId = null,
}: {
  hideWizardBack?: boolean;
  knownSources?: UserProject[];
  /**
   * Installation id from the signed-in GitHub session — present when the App is
   * already installed. Seeds the wizard so it skips the install step and starts
   * at "create".
   */
  sessionInstallationId?: string | null;
}) {
  const adapter = useAomiWalletKit();
  const actor = adapter.identity.address ?? undefined;

  const [state, setState] = useState<LaunchState>(() => {
    const loaded = loadLaunch();
    // One-click is the only path — always mount the wizard.
    loaded.path = PATH;
    // Skip-install: if the App is already installed and we don't have a repo
    // in flight yet, seed the installation id so the wizard opens at "create".
    // Never re-seed an installation a prior create already rejected.
    if (
      sessionInstallationId &&
      !loaded.oneshot.installationId &&
      sessionInstallationId !== loaded.rejectedInstallationId
    ) {
      loaded.oneshot.installationId = sessionInstallationId;
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const urlDeployId = url.searchParams.get("deployment_id");
      if (urlDeployId && !loaded.oneshot.deploymentId) {
        loaded.oneshot.deploymentId = urlDeployId;
      }
    }
    return loaded;
  });
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installSuccess, setInstallSuccess] = useState(false);

  const update = useCallback((next: LaunchState) => {
    setState(next);
    saveLaunch(next);
  }, []);

  // --- hydrate the GitHub install redirect (runs once) ----------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stripRedirectParams = () => {
      const url = new URL(window.location.href);
      let changed = false;
      for (const key of GITHUB_REDIRECT_KEYS) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      }
      if (changed) window.history.replaceState({}, "", url.toString());
    };

    // The backend redirects here with `launch=personal_required` (and no
    // installation id) when the user installed on an org. One-click only
    // supports their personal account, so surface that and keep them on the
    // install step instead of advancing to a create that would fail.
    const launchStatus = new URLSearchParams(window.location.search).get(
      "launch",
    );
    if (launchStatus === "personal_required") {
      setInstalling(false);
      setInstallSuccess(false);
      setInstallError(
        "One-click installs into your personal GitHub account. Please install the Aomi app on your personal account (not an organization), then continue.",
      );
      const cur = loadLaunch();
      update(
        withProgress(withPath(cur, PATH), PATH, {
          installationId: undefined,
          installationStatus: undefined,
        }),
      );
      stripRedirectParams();
      return;
    }

    const redirect = readGithubRedirect(window.location.search);
    if (!redirect) {
      setInstalling(false);
      setInstallError(null);
      const cur = loadLaunch();
      if (cur.pendingInstall) {
        update(withPendingInstall(cur, null));
      }
      return;
    }

    const cur = loadLaunch();
    // A fresh install supersedes any earlier rejection — clear the marker so
    // this installation can be used (and re-skipped) normally.
    const next = withRejectedInstall(
      withPendingInstall(
        withProgress(withPath(cur, PATH), PATH, {
          installationId: redirect.installationId,
          installationStatus: redirect.launchStatus ?? undefined,
        }),
        null,
      ),
      null,
    );
    update(next);
    setInstallSuccess(true);
    stripRedirectParams();
  }, [update]);

  // --- auto-dismiss the install-success banner after 6s ---------------------
  useEffect(() => {
    if (!installSuccess) return;
    const id = setTimeout(() => setInstallSuccess(false), 6000);
    return () => clearTimeout(id);
  }, [installSuccess]);

  // --- sync deploymentId to URL params -------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = state.oneshot.deploymentId;
    const url = new URL(window.location.href);
    const currentId = url.searchParams.get("deployment_id");
    if (id) {
      if (id !== currentId) {
        url.searchParams.set("deployment_id", id);
        url.searchParams.set("deploy_path", PATH);
        window.history.replaceState({}, "", url.toString());
      }
    } else if (currentId) {
      url.searchParams.delete("deployment_id");
      url.searchParams.delete("deploy_path");
      window.history.replaceState({}, "", url.toString());
    }
  }, [state.oneshot.deploymentId]);

  // --- actions handed to the wizard -----------------------------------------
  const restart = useCallback(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("deployment_id");
      url.searchParams.delete("deploy_path");
      window.history.replaceState({}, "", url.toString());
    }
    setInstalling(false);
    setInstallError(null);
    setInstallSuccess(false);
    // Preserve a known installation so restart doesn't re-ask for install —
    // unless a prior create rejected it (stale/wrong account), in which case
    // start fresh at the install step.
    const candidate = sessionInstallationId ?? state.oneshot.installationId;
    const keepInstall =
      candidate && candidate !== state.rejectedInstallationId
        ? candidate
        : undefined;
    update({
      ...state,
      path: PATH,
      pendingInstall: null,
      oneshot: keepInstall ? { installationId: keepInstall } : {},
    });
  }, [state, update, sessionInstallationId]);

  const patch = useCallback(
    (p: Partial<LaunchProgress>) => update(withProgress(state, PATH, p)),
    [state, update],
  );

  // A create attempt blamed the installation (uninstalled, wrong account,
  // missing permissions). Record it as rejected so it is never re-seeded from
  // the session cookie, and drop back to the install step to re-authorize.
  const onInstallRejected = useCallback(
    (installationId?: string) =>
      update(
        withRejectedInstall(
          withProgress(state, PATH, { installationId: undefined }),
          installationId ?? null,
        ),
      ),
    [state, update],
  );

  const onReset = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("deployment_id");
    url.searchParams.delete("deploy_path");
    window.history.replaceState({}, "", url.toString());
    update(withProgress(state, PATH, { deploymentId: undefined, live: false }));
  }, [state, update]);

  const beginInstall = useCallback(async () => {
    const next = withPendingInstall(withPath(state, PATH), { path: PATH });
    saveLaunch(next);
    setState(next);
    setInstallError(null);
    setInstalling(true);
    try {
      window.location.href = await githubAppInstallUrl({ app: 2 });
    } catch (error) {
      setInstalling(false);
      setInstallError(
        error instanceof Error
          ? error.message
          : "Failed to start GitHub App install.",
      );
    }
  }, [state]);

  // knownSources / hideWizardBack are accepted for parity with the dashboard's
  // call site; the one-click wizard derives everything it needs from `progress`.
  void knownSources;
  void hideWizardBack;

  return (
    <>
      {installSuccess && <InstallSuccessBanner />}
      <OneshotWizard
        progress={state.oneshot}
        actor={actor}
        onRestart={restart}
        beginInstall={beginInstall}
        installing={installing}
        installError={installError}
        patch={patch}
        onReset={onReset}
        onInstallRejected={onInstallRejected}
      />
    </>
  );
}

function InstallSuccessBanner() {
  return (
    <div className="mb-4 rounded-2xl border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-600">
      <CheckCircle2 className="-mt-0.5 mr-1.5 inline-block h-4 w-4 align-middle" />
      GitHub App installed successfully
    </div>
  );
}
