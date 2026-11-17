/** Deploys, activations, deployment status, projects and their agents. */
import { z } from "zod";

import {
  confirmed,
  dict,
  flag,
  list,
  maybe,
  maybeNum,
  maybeText,
  num,
  oneOf,
  opaque,
  probe,
  seconds,
  strings,
  text,
  wire,
} from "./wire";

export const PackageFileRecord = wire({
  path: text(),
  sha256: text(),
  bytes: num(0),
});
export type PackageFileRecord = z.output<typeof PackageFileRecord>;

export const PackageRecord = wire({
  name: text(),
  path: text(),
  aomiTomlPath: text(),
  releaseTag: text(),
  sdkVersion: maybeText,
  target: maybeText,
  files: list(PackageFileRecord),
});
export type PackageRecord = z.output<typeof PackageRecord>;

export const Source = wire({
  installationId: num(),
  repositoryId: num(),
  repositoryLink: text(),
  ref: text(),
  commitHash: text(),
});
export type Source = z.output<typeof Source>;

export const Platform = wire({
  platform: text(),
  repository: text(),
  deployBranch: text(),
  /** Generated branch in the platform repository (never a source-repo branch). */
  platformBranch: text(),
  commitHash: maybeText,
  prNumber: maybeNum,
  prUrl: maybeText,
  ciStatus: maybeText,
  ciUrl: maybeText,
  agents: list(PackageRecord),
});
export type Platform = z.output<typeof Platform>;

export const DeployPayload = wire({
  id: text(),
  status: text(),
  sdkVersion: maybeText,
  source: Source,
  platform: Platform,
});
export type DeployPayload = z.output<typeof DeployPayload>;

export const DeployResult = wire({ ok: confirmed, deployment: DeployPayload });
export type DeployResult = z.output<typeof DeployResult>;

export const ActivationPromotion = wire(
  {
    name: text(),
    releaseTag: text(),
    platformBranch: text(),
    platformCommitHash: maybeText,
    liveCommitHash: maybeText,
    activationStatus: maybeText,
    ciStatus: text(),
    ciUrl: maybeText,
    releaseAssets: strings,
    releaseAssetDigests: dict(z.string()),
  },
  { platformCommitHash: ["activated_commit_hash"] },
);
export type ActivationPromotion = z.output<typeof ActivationPromotion>;

export const ActivatedAgent = wire({
  agentId: maybeNum,
  name: text(),
  path: maybeText,
  releaseTag: maybeText,
  isActive: flag,
  artifactReady: flag,
  loaded: flag,
  error: maybeText,
  platformBranch: maybeText,
  liveCommitHash: maybeText,
  activationStatus: maybeText,
  activationPr: opaque<unknown>(),
  activationPrCloseError: maybeText,
});
export type ActivatedAgent = z.output<typeof ActivatedAgent>;

export const ActivateResult = wire({
  ok: flag,
  activation: wire({
    status: text(),
    platform: text(),
    target: wire({
      kind: text(),
      value: opaque<unknown>(),
      platformRepo: maybeText,
      platformBranch: maybeText,
      platformCommitHash: maybeText,
      ciStatus: maybeText,
      ciUrl: maybeText,
      promoted: list(ActivationPromotion),
    }),
    agents: list(ActivatedAgent),
  }),
});
export type ActivateResult = z.output<typeof ActivateResult>;

export const DeploymentAgentStatus = wire({
  name: text(),
  releaseTag: text(),
  releaseReady: flag,
  releaseAssets: strings,
  releaseAssetDigests: dict(z.string()),
  message: maybeText,
});
export type DeploymentAgentStatus = z.output<typeof DeploymentAgentStatus>;

export const DEPLOYMENT_STATES = [
  "no_ci",
  "building",
  "releasing",
  "ready",
  "failed",
  "pending",
] as const;

export const DeploymentStatus = wire({
  state: oneOf(DEPLOYMENT_STATES, "pending"),
  deployment: maybe(DeployPayload),
  releaseTags: strings,
  agents: list(DeploymentAgentStatus),
  ci: maybe(wire({ status: maybeText, url: maybeText, commitHash: maybeText })),
  message: maybeText,
});
export type DeploymentStatus = z.output<typeof DeploymentStatus>;

export const projectFields = {
  id: num(),
  installationId: num(),
  repositoryId: num(),
  repositoryLink: text(),
  platformId: num(),
  ownerBuilderId: num(),
  createdAt: num(),
  updatedAt: num(),
};

export const Project = wire(projectFields);
export type Project = z.output<typeof Project>;

export const AgentPricingSnapshot = wire({
  loadedAt: seconds,
  config: wire({
    version: num(0),
    beneficiaries: list(
      wire({ name: text(), type: text(), chain: text(), value: text() }),
    ),
    resources: dict(
      wire({ pricing: wire({ flat: num(0) }), beneficiary: maybeText }),
    ),
    outcome: list(z.record(z.string(), z.unknown())),
  }),
});
export type AgentPricingSnapshot = z.output<typeof AgentPricingSnapshot>;

export const PlatformAgent = wire({
  id: num(),
  name: text(),
  label: maybeText,
  platform: maybeText,
  isActive: flag,
  isPublic: flag,
  projectId: maybeNum,
  targetTags: strings,
  artifactReady: flag,
  /** Runtime probe result; undefined until a probe has answered. */
  loaded: probe,
  /** Exact runtime-validated pricing sidecar for the loaded release. */
  pricing: maybe(AgentPricingSnapshot),
});
export type PlatformAgent = z.output<typeof PlatformAgent>;

export const ServerTagsResult = wire({
  serverTags: strings,
  sdkVersion: text(),
  ffiVersion: maybeNum,
  ffiInterfaces: strings,
});
export type ServerTagsResult = z.output<typeof ServerTagsResult>;

/** One append-only promotion record from the deployment log. */
export const DeploymentRecord = wire({
  deploymentId: text(),
  releaseTag: text(),
  actor: maybeText,
  createdAt: seconds,
  sdkVersion: maybeText,
  current: flag,
});
export type DeploymentRecord = z.output<typeof DeploymentRecord>;

export const RerunDeploymentResult = wire({
  ok: confirmed,
  commitHash: maybeText,
  runId: maybeNum,
  ciUrl: maybeText,
});
export type RerunDeploymentResult = z.output<typeof RerunDeploymentResult> & {
  deploymentId: string;
};
