export type GuestSessionProvider = ((options?: {
  forceRefresh?: boolean;
}) => Promise<string | null>) & { clear(): void };

export function createGuestSessionProvider(input: {
  baseUrl: string;
  fetch?: typeof fetch;
}): GuestSessionProvider {
  const fetchImpl = input.fetch ?? globalThis.fetch.bind(globalThis);
  const browser = typeof location !== "undefined";
  const crossOriginBrowser = isCrossOriginBrowser(input.baseUrl);
  const runtime = crossOriginBrowser
    ? "cross-origin-browser"
    : browser
      ? "same-origin-browser"
      : "server";
  let credential: string | null | undefined;
  let pending: Promise<string | null> | null = null;
  const provider = async (options?: { forceRefresh?: boolean }) => {
    if (options?.forceRefresh) credential = undefined;
    if (credential !== undefined) return credential;
    // Same-origin requests already carry the Better Auth cookie. Try it before
    // creating an anonymous account so a signed-in user is never replaced by a
    // guest merely because the Agent client initialized.
    if (runtime === "same-origin-browser" && !options?.forceRefresh) {
      return null;
    }
    pending ??= signInAnonymous(fetchImpl, input.baseUrl, runtime).finally(
      () => {
        pending = null;
      },
    );
    credential = await pending;
    return credential;
  };
  return Object.assign(provider, {
    clear() {
      credential = undefined;
    },
  });
}

function isCrossOriginBrowser(baseUrl: string): boolean {
  if (typeof location === "undefined") return false;
  return new URL(baseUrl, location.origin).origin !== location.origin;
}

async function signInAnonymous(
  fetchImpl: typeof fetch,
  baseUrl: string,
  runtime: "cross-origin-browser" | "same-origin-browser" | "server",
) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const authEndpoint = `${normalizedBase}/api/auth/sign-in/anonymous`;
  const response = await fetchImpl(
    runtime === "cross-origin-browser"
      ? `${normalizedBase}/api/auth/widget/guest`
      : authEndpoint,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
      credentials: runtime === "same-origin-browser" ? "include" : "omit",
    },
  );
  if (
    response.status === 409 &&
    (await responseCode(response)) === "session_exists"
  ) {
    return null;
  }
  // Better Auth refuses a second anonymous sign-in while an anonymous
  // session cookie is live. That cookie IS a working credential — fall back
  // to it instead of failing the caller's request.
  if (
    response.status === 400 &&
    (await responseCode(response)) ===
      "ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY"
  ) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Aomi guest sign-in failed with HTTP ${response.status}`);
  }
  if (runtime === "same-origin-browser") return null;
  const body = await response.json().catch(() => null);
  const token =
    runtime === "cross-origin-browser"
      ? stringProperty(body, "access_token")
      : (stringProperty(body, "token") ??
        response.headers.get("set-auth-token"));
  if (!token) throw new Error("Aomi guest sign-in returned no bearer session");
  return token;
}

function stringProperty(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object" || !(property in value)) return null;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" && candidate ? candidate : null;
}

async function responseCode(response: Response) {
  return response
    .clone()
    .json()
    .then((body: unknown) =>
      body && typeof body === "object" && "code" in body
        ? String(body.code)
        : null,
    )
    .catch(() => null);
}
