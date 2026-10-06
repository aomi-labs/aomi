"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import type {
  UserProject,
  UserProjectLatestDeployment,
} from "@aomi-labs/deploy";
import { HelpBadge } from "@build/components/help-badge";
import type { TimelineDeployment } from "../deployment-timeline";
import { sdkCompatibility } from "../sdk-compatibility";

const GITHUB = "https://github.com";

function GhLink({ text, href }: { text: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-warning inline-flex items-center gap-1 break-all font-mono hover:underline"
    >
      {text}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

function MetaRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border grid grid-cols-[160px_minmax(0,1fr)] items-baseline gap-4 border-b py-2.5 last:border-b-0 max-sm:grid-cols-1 max-sm:gap-1">
      <dt className="text-dim inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
        {label}
        {hint && <HelpBadge label={`About ${label}`}>{hint}</HelpBadge>}
      </dt>
      <dd className="min-w-0 text-xs">{children}</dd>
    </div>
  );
}

/** App rows: prefer the GitHub-backed history entry (release tag + target),
 *  fall back to zipping the DB record's app/release-tag lists. */
function appRows(
  deployment: TimelineDeployment,
  entry: UserProjectLatestDeployment | null,
) {
  if (entry && entry.apps.length > 0) {
    return entry.apps.map((app) => ({
      name: app.name,
      releaseTag: app.releaseTag ?? app.appReleaseTag ?? null,
      target: app.target ?? null,
    }));
  }
  return deployment.apps.map((name, i) => ({
    name,
    releaseTag: deployment.releaseTags[i] ?? deployment.releaseTags[0] ?? null,
    target: null,
  }));
}

/**
 * The expansion of one deployment row: what this deployment actually is,
 * every field named for the builder and linked to the real thing on GitHub.
 * DB-backed fields render immediately; the platform-side fields (branch,
 * built commit, CI link) arrive with the lazily-loaded history entry.
 */
export function DeploymentDetail({
  deployment,
  source,
  requiredSdk,
  entry,
  platformRepo,
  historyPending,
  expanded,
  onToggle,
}: {
  deployment: TimelineDeployment;
  source: UserProject;
  requiredSdk: string | null;
  /** History entry matched by deploymentId, when loaded. */
  entry: UserProjectLatestDeployment | null;
  /** Platform repo (`owner/name`) resolved from any history entry. */
  platformRepo: string | null;
  historyPending: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const repo = source.repositoryLink;
  const shortCommit = deployment.commit;
  const fullCommit =
    shortCommit && entry?.commitHash?.startsWith(shortCommit)
      ? entry.commitHash
      : null;
  const outdated =
    deployment.current &&
    sdkCompatibility(deployment.sdkVersion, requiredSdk) === "outdated";
  const platformName = source.platformName;
  const platformBranch = entry?.platformBranch ?? null;
  const apps = appRows(deployment, entry);
  const releaseUrl = (tag: string) =>
    platformRepo ? `${GITHUB}/${platformRepo}/releases/tag/${tag}` : null;
  const assetUrl = (tag: string, asset: string) =>
    platformRepo
      ? `${GITHUB}/${platformRepo}/releases/download/${tag}/${asset}`
      : null;
  // "ready"/live states mean CI published the release; anything in flight
  // (or an entry that says building) keeps the artifacts block pending.
  const artifactsPublished = entry
    ? entry.state === "ready" ||
      entry.apps.some((app) => app.artifactReady === true) ||
      deployment.current
    : true;

  return (
    <div className="border-border border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="text-dim hover:text-foreground flex w-full items-center gap-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider"
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden
        />
        Deployment detail
        <span className="text-dim/70 truncate font-mono text-[10px] font-normal normal-case tracking-normal">
          {deployment.deploymentId}
        </span>
      </button>

      {expanded && (
        <div className="bg-surface-1/40 px-4 pb-4">
          <dl>
            <MetaRow label="Source repository">
              {repo ? (
                <GhLink text={repo} href={`${GITHUB}/${repo}`} />
              ) : (
                <span className="text-dim">unknown</span>
              )}
            </MetaRow>
            <MetaRow label="Commit">
              {shortCommit && repo ? (
                <>
                  <GhLink
                    text={shortCommit}
                    href={`${GITHUB}/${repo}/commit/${fullCommit ?? shortCommit}`}
                  />
                  {fullCommit && (
                    <div className="text-dim/70 mt-0.5 break-all font-mono text-[10px]">
                      {fullCommit}
                    </div>
                  )}
                </>
              ) : (
                <span className="font-mono">{shortCommit ?? "unknown"}</span>
              )}
            </MetaRow>
            <MetaRow label="SDK version">
              <span className="font-mono">
                {deployment.sdkVersion ?? "unknown"}
              </span>
              {outdated && requiredSdk && (
                <span className="bg-warning/10 text-warning border-warning/40 ml-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                  requires {requiredSdk}
                </span>
              )}
            </MetaRow>
            <MetaRow label="Deployed platform">
              {platformName && platformRepo ? (
                <>
                  <GhLink
                    text={platformName}
                    href={`${GITHUB}/${platformRepo}`}
                  />
                  <div className="text-dim/70 mt-0.5 font-mono text-[10px]">
                    {platformRepo}
                  </div>
                </>
              ) : (
                <span className="text-dim">
                  {platformName ?? (historyPending ? "loading…" : "unknown")}
                </span>
              )}
            </MetaRow>
            <MetaRow
              label="Platform branch"
              hint="The platform's copy of your app. Aomi mirrors your source onto this branch in the platform repository, where CI builds and publishes it."
            >
              {platformBranch && platformRepo ? (
                <GhLink
                  text={platformBranch}
                  href={`${GITHUB}/${platformRepo}/tree/${platformBranch}`}
                />
              ) : (
                <span className="text-dim">
                  {historyPending ? "loading…" : "unavailable"}
                </span>
              )}
            </MetaRow>
          </dl>

          <div className="mt-3">
            <div className="text-dim mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
              Apps <span className="text-dim/70">· {apps.length}</span>
              <HelpBadge label="About apps">
                One deployment can contain multiple apps — each is compiled and
                released independently under its own release tag.
              </HelpBadge>
            </div>
            <div className="grid gap-2">
              {apps.map((app) => (
                <div
                  key={app.name}
                  className="border-border bg-surface-1 rounded-md border px-3 py-2.5"
                >
                  <div className="text-xs font-semibold">{app.name}</div>
                  <div className="mt-1.5 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] max-sm:grid-cols-1">
                    <span className="text-dim uppercase tracking-wider">
                      Release tag
                    </span>
                    <span className="min-w-0">
                      {app.releaseTag ? (
                        releaseUrl(app.releaseTag) ? (
                          <GhLink
                            text={app.releaseTag}
                            href={releaseUrl(app.releaseTag) as string}
                          />
                        ) : (
                          <span className="break-all font-mono">
                            {app.releaseTag}
                          </span>
                        )
                      ) : (
                        <span className="text-dim">none</span>
                      )}
                    </span>
                    <span className="text-dim uppercase tracking-wider">
                      Target
                    </span>
                    <span className="font-mono">
                      {app.target ?? (historyPending ? "loading…" : "—")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-dim mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
              Build artifacts
              <HelpBadge label="About build artifacts">
                Published by platform CI as a GitHub release. The runtime
                downloads the tarball and verifies the plugin against the
                manifest digest before loading.
              </HelpBadge>
            </div>
            {artifactsPublished ? (
              <dl>
                {entry?.commitHash && (
                  <MetaRow label="Built commit">
                    {platformRepo ? (
                      <GhLink
                        text={entry.commitHash.slice(0, 12)}
                        href={`${GITHUB}/${platformRepo}/commit/${entry.commitHash}`}
                      />
                    ) : (
                      <span className="font-mono">
                        {entry.commitHash.slice(0, 12)}
                      </span>
                    )}
                    <span className="text-dim/70 ml-2 text-[10px]">
                      candidate — the commit CI actually built
                    </span>
                  </MetaRow>
                )}
                {apps
                  .filter((app) => app.releaseTag)
                  .map((app) => (
                    <MetaRow key={app.name} label={`${app.name} assets`}>
                      {platformRepo ? (
                        <span className="flex flex-col gap-0.5">
                          {app.target && (
                            <GhLink
                              text={`aomi-plugins-…-${app.target}.tar.gz`}
                              href={
                                assetUrl(
                                  app.releaseTag as string,
                                  `aomi-plugins-${app.releaseTag}-${app.target}.tar.gz`,
                                ) as string
                              }
                            />
                          )}
                          <GhLink
                            text="manifest.json"
                            href={
                              assetUrl(
                                app.releaseTag as string,
                                "manifest.json",
                              ) as string
                            }
                          />
                          <GhLink
                            text="aomi-release.json"
                            href={
                              assetUrl(
                                app.releaseTag as string,
                                "aomi-release.json",
                              ) as string
                            }
                          />
                        </span>
                      ) : (
                        <span className="text-dim">
                          {historyPending
                            ? "loading…"
                            : "platform repo unknown"}
                        </span>
                      )}
                    </MetaRow>
                  ))}
              </dl>
            ) : (
              <div className="text-dim flex items-start gap-2 text-xs">
                <span
                  aria-hidden
                  className="bg-warning mt-1.5 size-2 shrink-0 rounded-full"
                />
                <span>
                  Waiting on platform CI — the compiled plugin and release
                  assets appear here once{" "}
                  <code className="font-mono">manifest.json</code> is published.
                  {entry?.ciUrl && (
                    <>
                      {" "}
                      <a
                        href={entry.ciUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-warning font-medium underline underline-offset-2"
                      >
                        View CI run
                      </a>
                    </>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
