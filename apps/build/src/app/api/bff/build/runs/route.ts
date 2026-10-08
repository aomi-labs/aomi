import {
  buildRunStatusRoute,
  createBuildRunRoute,
} from "@/server/bff/build/routes";

export const POST = createBuildRunRoute;
export const GET = buildRunStatusRoute;
