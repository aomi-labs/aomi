import {
  operateBotsCreateRoute,
  operateBotsDeleteRoute,
  operateBotsRoute,
  operateBotsUpdateRoute,
} from "@/server/bff/operate/routes";

export const GET = operateBotsRoute;
export const POST = operateBotsCreateRoute;
export const DELETE = operateBotsDeleteRoute;
export const PATCH = operateBotsUpdateRoute;
