import type { UserProject } from "../types";

export type LaunchAgentStatusAgent = {
  id?: number;
  name: string;
  is_active: boolean;
  loaded: boolean;
};

export type LaunchAgentStatusesResult = {
  ok: boolean;
  projectId: number;
  state: "pending" | "live";
  agents: LaunchAgentStatusAgent[];
};

export type DeploymentProjectsResult = {
  projects: UserProject[];
  githubLogin?: string;
};
