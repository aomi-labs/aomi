/** Project reads and private-agent keys over the manager contract. */
import { BackendError, type UserProject as Project } from "@aomi-labs/deploy";
import { launchAgentStatusesResult } from "@aomi-labs/internal";
import { z } from "zod";
import { EdgeError } from "../kernel/errors";
import { id } from "../kernel/route";
import {
  endpoint,
  notFound,
  platformSlug,
  type BuildRoute,
  type Call,
} from "./endpoint";
import { buildError } from "./failures";

const deployments = (name: string) => `/api/build/deployments/${name}`;
const byProject = z.object({ projectId: id });
const byAgent = z.object({ agentId: id });

async function owned(
  { client, session }: Call<unknown>,
  projectId: number,
  missing = "project not found for this user",
): Promise<Project> {
  const projects = await client.listUserProjects({
    githubUserId: session.githubUserId,
  });
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) throw notFound(missing);
  return project;
}

const projectAgents = endpoint(
  "deployment.agents",
  "GET",
  deployments("agents"),
  {
    input: byProject,
    run: async (call) => {
      const project = await owned(call, call.input.projectId);
      const { agents } = await call.client.listUserProjectAgents({
        githubUserId: call.session.githubUserId,
        projectId: project.id,
      });
      return launchAgentStatusesResult(project.id, agents);
    },
  },
);

const userProjects = endpoint(
  "deployment.projects",
  "GET",
  deployments("projects"),
  {
    auth: { cliScope: "deployment:read" },
    input: z.object({
      platform: platformSlug.optional(),
      projectId: id.optional(),
    }),
    run: async ({ input, client, session, visibilityGrant }) => {
      const scope = {
        githubUserId: session.githubUserId,
        visibilityGrant: visibilityGrant ?? undefined,
      };
      return {
        projects:
          input.projectId === undefined
            ? await client.listUserProjects({
                ...scope,
                platform: input.platform,
              })
            : [
                await client.getUserProject({
                  ...scope,
                  projectId: input.projectId,
                }),
              ],
        githubLogin: session.githubLogin,
      };
    },
  },
);

function agentKey(method: "GET" | "POST") {
  return endpoint("deployment.agent_key", method, deployments("agent-key"), {
    auth: { write: method === "POST" },
    input: byAgent,
    run: async ({ input, client, session }) => {
      const scope = {
        githubUserId: session.githubUserId,
        agentId: input.agentId,
        actor: session.githubLogin,
      };
      try {
        return {
          agentKey: await (method === "POST"
            ? client.regenerateBuilderAgentKey(scope)
            : client.getBuilderAgentKey(scope)),
        };
      } catch (error) {
        if (error instanceof BackendError && error.status === 404)
          throw notFound("agent not found for this user");
        throw error;
      }
    },
  });
}

const githubAppInstallations = endpoint(
  "deployment.github_app_installations",
  "GET",
  deployments("github-app"),
  {
    run: ({ client, session }) =>
      client
        .listUserGitHubAppInstallations({ githubUserId: session.githubUserId })
        .catch((error: unknown) => {
          throw new EdgeError(
            buildError(error).status,
            "Couldn’t check GitHub repository access. Try again.",
            {
              cause: error,
            },
          );
        }),
  },
);

const deleteProject = endpoint(
  "project.delete",
  "DELETE",
  "/api/build/projects",
  {
    auth: { write: true },
    input: byProject,
    status: 204,
    run: async ({ input, client, session }) => {
      await client.deleteUserProject({
        projectId: input.projectId,
        githubUserId: session.githubUserId,
      });
      return new Response(null, { status: 204 });
    },
  },
);

export const DEPLOY_ROUTES: readonly BuildRoute[] = [
  userProjects,
  deleteProject,
  projectAgents,
  agentKey("GET"),
  agentKey("POST"),
  githubAppInstallations,
];
