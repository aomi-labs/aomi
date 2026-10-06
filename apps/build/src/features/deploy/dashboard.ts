// Client seam for the GitHub-signed-in deploy dashboard. Talks only to the
// same-origin Aomi Build BFF (`/api/bff/auth/github/*`, `/api/bff/launch/projects`);
// the GitHub session cookie + service bearer stay server-side.

import { resetLaunch } from "./state";
import type {
  GitHubSessionInfo,
  UserProject,
  UserProjectsResult,
} from "@aomi-labs/deploy/launch";
import {
  githubSigninUrl,
  launchFetchGitHubSession,
  launchProjects,
  launchSignOutGitHub,
} from "./client";

export type { GitHubSessionInfo, UserProject, UserProjectsResult };

/** Where the "Sign in with GitHub" button points. */
export const GITHUB_SIGNIN_URL = githubSigninUrl;

export function fetchGitHubSession(): Promise<GitHubSessionInfo> {
  return launchFetchGitHubSession();
}

export async function signOutGitHub(): Promise<void> {
  try {
    await launchSignOutGitHub();
  } finally {
    // Signing out must not leave one account's in-flight wizard state
    // (installation id, source id, repo, deployment id) in localStorage for the
    // next account that signs in on the same browser — clear it every time.
    resetLaunch();
  }
}

export function fetchUserProjects(): Promise<UserProjectsResult> {
  return launchProjects();
}
