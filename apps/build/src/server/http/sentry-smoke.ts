import {
  APP_SENTRY_SMOKE_HEADER,
  runAppSentrySmoke,
} from "@aomi-labs/observability/smoke";

function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  const emitted = await runAppSentrySmoke({
    service: "build",
    providedSecret: request.headers.get(APP_SENTRY_SMOKE_HEADER),
  });
  return new Response(null, { status: emitted ? 204 : 404 });
}

export const GET = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
