import "server-only";
import { productionDeployment } from "@/server/env";

// One-shot App OAuth client ids (app index 2). Both the browser UI and CLI
// login use this app so the backend exchange can resolve the Builder identity.
const STAGING_CLIENT_ID = "Iv23lilgvJz13pJekLSZ";
const PRODUCTION_CLIENT_ID = "Iv23li4wPpAfoGOJ6v0Q";

export const GITHUB_LOGIN_APP_INDEX = 2;

export function githubOAuthClientId(req: Request): string {
  const host = new URL(req.url).hostname;
  if (productionDeployment() || host === "build.aomi.dev") {
    return PRODUCTION_CLIENT_ID;
  }
  return STAGING_CLIENT_ID;
}
