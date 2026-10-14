import {
  operateModelKeysDeleteRoute,
  operateModelKeysGrantsRoute,
  operateModelKeysRoute,
  operateModelKeysSaveRoute,
} from "@/server/bff/operate/routes";

export const GET = operateModelKeysRoute;
export const POST = operateModelKeysSaveRoute;
export const PUT = operateModelKeysGrantsRoute;
export const DELETE = operateModelKeysDeleteRoute;
