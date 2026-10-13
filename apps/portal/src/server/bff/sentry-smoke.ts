import {
  BFF_SENTRY_SMOKE_HEADER,
  runBffSentrySmoke,
} from "@aomi-labs/observability/smoke";

function notFound(): Response {
  return new Response(null, { status: 404 });
}

/** Emits a Sentry smoke event when the shared secret matches; every other method is 404. */
export const sentrySmoke = {
  async POST(request: Request): Promise<Response> {
    const emitted = await runBffSentrySmoke({
      service: "portal-bff",
      providedSecret: request.headers.get(BFF_SENTRY_SMOKE_HEADER),
    });
    return new Response(null, { status: emitted ? 204 : 404 });
  },
  GET: notFound,
  PUT: notFound,
  PATCH: notFound,
  DELETE: notFound,
  OPTIONS: notFound,
};
