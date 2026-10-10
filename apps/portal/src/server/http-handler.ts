import "@tanstack/react-start/server-only";
type Params = Record<string, string | string[] | undefined>;
export function invokeHandler<P extends Params>(
  handler: (
    request: Request,
    context: { params: Promise<P> },
  ) => Response | Promise<Response>,
  request: Request,
  params: P,
) {
  return handler(request, { params: Promise.resolve(params) });
}
