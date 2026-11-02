import { createIsomorphicFn } from "@tanstack/react-start";

/** SSR render errors end in the root errorComponent; report them like uncaught request errors. */
export const reportRenderError = createIsomorphicFn()
  .server(async (error: unknown) => {
    const { portalFailures } = await import("@/server/failures");
    portalFailures.handle({
      source: "uncaught",
      error,
      context: { routeFamily: "/ssr", operation: "start.render_error" },
    });
  })
  .client(() => {});
