import {
  deploymentSecretsRoute,
  deploymentSecretsWriteRoute,
  deploymentSecretsDeleteRoute,
} from "@/server/bff/deploy/routes";

export const GET = deploymentSecretsRoute;
export const POST = deploymentSecretsWriteRoute;
export const DELETE = deploymentSecretsDeleteRoute;
