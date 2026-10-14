import {
  integrationsConnectRoute,
  integrationsStatusRoute,
} from "@/server/bff/integrations/routes";

export const GET = integrationsStatusRoute;
export const POST = integrationsConnectRoute;
