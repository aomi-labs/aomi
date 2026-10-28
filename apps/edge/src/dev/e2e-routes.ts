import {
  parseChainId,
  type WalletSolanaSignMessagePayload,
  type WalletSolanaSignPayload,
  type WalletTxPayload,
} from "@aomi-labs/client";
import {
  E2E_WALLET_COOKIE,
  executeE2ESolanaTransaction,
  executeE2EvmTransaction,
  isE2EExecutorEnabled,
  isE2ESolanaExecutorEnabled,
  isE2EWalletEnabled,
  mintE2EWalletCookie,
  parseE2EAddress,
  parseE2ESvmAddress,
  parseE2ESvmCluster,
  parseE2ETtlSeconds,
  signE2ESolanaMessage,
  validateE2EWalletToken,
  verifyE2EWalletCookie,
} from "./e2e-wallet";

/** The local E2E wallet's routes, served by the dev entry only. */
const ROUTES: Record<string, { method: string; handle: (request: Request) => Promise<Response> | Response }> = {
  "/api/bff/e2e/wallet": { method: "GET", handle: seedWallet },
  "/api/bff/e2e/execute": { method: "POST", handle: executeEvm },
  "/api/bff/e2e/solana": { method: "POST", handle: executeSolana },
};

/** Serve an E2E wallet route; null for any other request. */
export async function handleE2ERequest(request: Request): Promise<Response | null> {
  const route = ROUTES[new URL(request.url).pathname];
  if (!route || request.method !== route.method) return null;
  return route.handle(request);
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function redirectTarget(request: Request): URL {
  const url = new URL(request.url);
  const target = new URL(url.searchParams.get("redirect") ?? "/", url.origin);
  return target.origin === url.origin ? target : new URL("/", url.origin);
}

function cookieOf(request: Request): string | undefined {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${E2E_WALLET_COOKIE}=`))
    ?.slice(E2E_WALLET_COOKIE.length + 1);
}

function redirect(request: Request, cookie: string): Response {
  return new Response(null, {
    status: 307,
    headers: { location: redirectTarget(request).toString(), "set-cookie": cookie },
  });
}

export function seedWallet(request: Request): Response {
  if (!isE2EWalletEnabled()) {
    return new Response("E2E wallet seeding is disabled", { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  if (params.get("clear") === "1") {
    return redirect(request, `${E2E_WALLET_COOKIE}=; Path=/; Max-Age=0`);
  }

  if (!validateE2EWalletToken(params.get("token"))) {
    return new Response("Invalid E2E wallet token", { status: 401 });
  }

  const rawAddress = params.get("address");
  const rawSvmAddress = params.get("svmAddress");
  const address = parseE2EAddress(rawAddress);
  const svmAddress = parseE2ESvmAddress(rawSvmAddress);
  if ((rawAddress && !address) || (rawSvmAddress && !svmAddress)) {
    return new Response("Invalid E2E wallet address", { status: 400 });
  }
  if (!address && !svmAddress) {
    return new Response("An EVM or Solana address is required", { status: 400 });
  }

  const chainId = parseChainId(params.get("chainId")) ?? 1;
  const ttlSeconds = parseE2ETtlSeconds(params.get("ttl"));
  const cookie = mintE2EWalletCookie({
    address: address ?? undefined,
    chainId: address ? chainId : undefined,
    svmAddress: svmAddress ?? undefined,
    svmCluster: svmAddress
      ? parseE2ESvmCluster(params.get("svmCluster"))
      : undefined,
    ttlSeconds,
  });
  if (!cookie) {
    return new Response("E2E wallet seeding is unavailable", { status: 503 });
  }
  // Readable by the page: the portal shows the seeded wallet from it, and
  // only these routes, which verify its signature, act on it.
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(request, `${E2E_WALLET_COOKIE}=${cookie}; Path=/; Max-Age=${ttlSeconds}; SameSite=Lax${secure}`);
}

export async function executeEvm(request: Request): Promise<Response> {
  if (!isE2EExecutorEnabled()) {
    return new Response("E2E execution is disabled", { status: 404 });
  }
  if (!isSameOrigin(request)) {
    return Response.json(
      { ok: false, code: "unauthorized", error: "Cross-origin request denied" },
      { status: 403 },
    );
  }

  const seed = verifyE2EWalletCookie(cookieOf(request));
  if (!seed) {
    return Response.json(
      { ok: false, code: "unauthorized", error: "Missing E2E wallet seed" },
      { status: 401 },
    );
  }

  let payload: WalletTxPayload;
  try {
    const body = (await request.json()) as { payload?: WalletTxPayload };
    if (!body.payload || typeof body.payload !== "object") {
      throw new Error("Missing payload");
    }
    payload = body.payload;
  } catch {
    return Response.json(
      { ok: false, code: "invalid_request", error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const result = await executeE2EvmTransaction({ seed, payload });
  if (result.ok) {
    return Response.json(result);
  }

  const status =
    result.code === "unauthorized"
      ? 401
      : result.code === "invalid_request"
        ? 400
        : result.code === "policy_rejected"
          ? 422
          : result.code === "rpc_unavailable"
            ? 503
            : 500;

  return Response.json(result, { status });
}

type RequestBody =
  | { action: "sign-message"; payload: WalletSolanaSignMessagePayload }
  | {
      action: "sign" | "sign-and-send";
      payload: WalletSolanaSignPayload;
    };

export async function executeSolana(request: Request): Promise<Response> {
  if (!isE2ESolanaExecutorEnabled()) {
    return new Response("E2E Solana execution is disabled", {
      status: 404,
    });
  }
  if (!isSameOrigin(request)) {
    return Response.json(
      { ok: false, error: "Cross-origin request denied" },
      { status: 403 },
    );
  }
  const seed = verifyE2EWalletCookie(cookieOf(request));
  if (!seed?.svmAddress) {
    return Response.json(
      { ok: false, error: "Missing Solana wallet seed" },
      { status: 401 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
    if (!body?.action || !body.payload) throw new Error("invalid");
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const result =
    body.action === "sign-message"
      ? await signE2ESolanaMessage({
          seed,
          message: body.payload.message ?? "",
        })
      : await executeE2ESolanaTransaction({
          seed,
          payload: body.payload,
          broadcast: body.action === "sign-and-send",
        });
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
