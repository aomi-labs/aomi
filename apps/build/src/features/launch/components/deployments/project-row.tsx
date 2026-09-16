import Link from "next/link";
import type { UserProject } from "@aomi-labs/deploy";
import { projectDeploymentStatus } from "./project-deployment-status";
import { sdkCompatibility, sourceSdkVersion } from "./sdk-compatibility";
import { StatusDot } from "./ui/status-dot";
import { SdkBadge } from "./ui/sdk-badge";

export function ProjectRow({
  source,
  requiredSdk,
  href,
}: {
  source: UserProject;
  requiredSdk?: string | null;
  href?: string;
}) {
  const status = projectDeploymentStatus(source);
  const appLabel =
    source.apps.length === 0
      ? "No apps"
      : source.apps.length === 1
        ? source.apps[0]?.name
        : `${source.apps.length} apps`;
  const stamped = sourceSdkVersion(source);
  const mixedSdk = (source.sdkVersions?.length ?? 0) > 1;
  const boundPlatform = source.platformName.trim();
  const projectHref =
    href ??
    `/projects/${source.id}${
      boundPlatform ? `?platform=${encodeURIComponent(boundPlatform)}` : ""
    }`;
  const deploymentsHref = `${projectHref}${
    projectHref.includes("?") ? "&" : "?"
  }tab=deployments`;
  const outdated = mixedSdk
    ? (source.sdkVersions ?? []).some(
        (sdkVersion) =>
          sdkCompatibility(sdkVersion, requiredSdk) === "outdated",
      )
    : sdkCompatibility(stamped, requiredSdk) === "outdated";
  return (
    <div className="border-border hover:bg-accent-hover flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <Link
        href={projectHref}
        prefetch={false}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="border-border flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-medium">
          {(source.repositoryLink ?? "A").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {source.repositoryLink ?? "Unknown repository"}
          </div>
          <div className="text-dim mt-1 flex items-center gap-2 text-xs">
            <StatusDot state={outdated ? "outdated" : status.dotState} />
            <span>{outdated ? "Outdated" : status.label}</span>
            <span aria-hidden>·</span>
            <span>{appLabel}</span>
          </div>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <SdkBadge
          stamped={stamped}
          required={requiredSdk}
          label={mixedSdk ? "SDK mixed" : undefined}
        />
        {outdated && (
          <Link
            href={deploymentsHref}
            prefetch={false}
            className="border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-xs font-medium"
          >
            Upgrade
          </Link>
        )}
      </div>
    </div>
  );
}
