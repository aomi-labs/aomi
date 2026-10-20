import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function immutableURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.app") &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function selectDeployment(rows, environment, sha) {
  // GitHub's response ordering is not an identity or freshness guarantee.
  return rows
    .filter((row) => row.environment === environment && row.sha === sha)
    .sort((a, b) => b.id - a.id)[0];
}

export function successfulURL(statuses) {
  // A later error/inactive observation invalidates a prior success.
  const latest = [...statuses].sort((a, b) => b.id - a.id)[0];
  if (["error", "failure"].includes(latest?.state))
    throw Error(
      `Vercel deployment ${latest.state}; inspect its GitHub deployment status`,
    );
  return latest?.state === "success"
    ? immutableURL(latest.environment_url)
    : null;
}

export async function resolve({
  sha,
  read,
  output,
  seconds = 1200,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.error,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(sha) ||
    !Number.isSafeInteger(seconds) ||
    seconds < 1
  )
    throw Error("Exact SHA and positive timeout required");
  const pending = new Map([
    ["Preview – chat-portal", "portal_url"],
    ["Preview – aomi-build", "build_url"],
  ]);
  const deadline = now() + seconds * 1000;
  while (now() < deadline) {
    const rows = await read(`deployments?sha=${sha}&per_page=100`);
    for (const [environment, key] of pending) {
      const deployment = selectDeployment(rows, environment, sha);
      if (!deployment) {
        log(
          `${environment}: waiting for Vercel to publish a deployment for ${sha}`,
        );
        continue;
      }
      const url = successfulURL(
        await read(`deployments/${deployment.id}/statuses?per_page=100`),
      );
      if (url) {
        output(key, url);
        pending.delete(environment);
      } else
        log(
          `${environment}: deployment ${deployment.id} has no current successful immutable URL`,
        );
    }
    if (!pending.size) return;
    await wait(Math.min(15000, Math.max(0, deadline - now())));
  }
  throw Error(
    `Vercel/GitHub deployment publication timed out for ${[...pending.keys()].join(", ")} at ${sha}; inspect Vercel queue/build and GitHub deployment delivery. QA has not run.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { GH_TOKEN, GITHUB_REPOSITORY, PREVIEW_SHA, GITHUB_OUTPUT } =
    process.env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !GITHUB_OUTPUT)
    throw Error("GitHub credentials, repository and output required");
  await resolve({
    sha: PREVIEW_SHA,
    seconds: Number(process.env.PREVIEW_TIMEOUT_SECONDS ?? 1200),
    read: (path) =>
      JSON.parse(
        execFileSync("gh", ["api", `repos/${GITHUB_REPOSITORY}/${path}`], {
          encoding: "utf8",
          timeout: 15000,
        }),
      ),
    output: (key, url) => appendFileSync(GITHUB_OUTPUT, `${key}=${url}\n`),
  });
}
