import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type {
  WalletSolanaSignMessagePayload,
  WalletSolanaSignPayload,
} from "@aomi-labs/client";
import type { WalletTxPayload } from "@aomi-labs/react";
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
import { parseChainId } from "@aomi-labs/client";

/** The local E2E wallet's routes. Loaded only when dev tools are allowed. */

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function redirectTarget(request: NextRequest): URL {
  const requested = request.nextUrl.searchParams.get("redirect") ?? "/";
  const host = request.headers.get("host");
  const origin = host
    ? `${request.nextUrl.protocol}//${host}`
    : request.nextUrl.origin;
  const target = new URL(requested, origin);
  if (target.origin !== origin) {
    return new URL("/", origin);
  }
  return target;
}

export function seedWallet(request: NextRequest): Response {
  if (!isE2EWalletEnabled()) {
    return new NextResponse("E2E wallet seeding is disabled", {
      status: 404,
    });
  }

  const response = NextResponse.redirect(redirectTarget(request));

  if (request.nextUrl.searchParams.get("clear") === "1") {
    response.cookies.delete(E2E_WALLET_COOKIE);
    return response;
  }

  if (!validateE2EWalletToken(request.nextUrl.searchParams.get("token"))) {
    return new NextResponse("Invalid E2E wallet token", { status: 401 });
  }

  const rawAddress = request.nextUrl.searchParams.get("address");
  const rawSvmAddress = request.nextUrl.searchParams.get("svmAddress");
  const address = parseE2EAddress(rawAddress);
  const svmAddress = parseE2ESvmAddress(rawSvmAddress);
  if ((rawAddress && !address) || (rawSvmAddress && !svmAddress)) {
    return new NextResponse("Invalid E2E wallet address", { status: 400 });
  }
  if (!address && !svmAddress) {
    return new NextResponse("An EVM or Solana address is required", {
      status: 400,
    });
  }

  const chainId =
    parseChainId(request.nextUrl.searchParams.get("chainId")) ?? 1;
  const ttlSeconds = parseE2ETtlSeconds(
    request.nextUrl.searchParams.get("ttl"),
  );
  const cookie = mintE2EWalletCookie({
    address: address ?? undefined,
    chainId: address ? chainId : undefined,
    svmAddress: svmAddress ?? undefined,
    svmCluster: svmAddress
      ? parseE2ESvmCluster(request.nextUrl.searchParams.get("svmCluster"))
      : undefined,
    ttlSeconds,
  });
  if (!cookie) {
    return new NextResponse("E2E wallet seeding is unavailable", {
      status: 503,
    });
  }

  response.cookies.set(E2E_WALLET_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ttlSeconds,
  });
  return response;
}

export async function executeEvm(request: NextRequest): Promise<Response> {
  if (!isE2EExecutorEnabled()) {
    return new NextResponse("E2E execution is disabled", { status: 404 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, code: "unauthorized", error: "Cross-origin request denied" },
      { status: 403 },
    );
  }

  const seed = verifyE2EWalletCookie(
    request.cookies.get(E2E_WALLET_COOKIE)?.value,
  );
  if (!seed) {
    return NextResponse.json(
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
    return NextResponse.json(
      { ok: false, code: "invalid_request", error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const result = await executeE2EvmTransaction({ seed, payload });
  if (result.ok) {
    return NextResponse.json(result);
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

  return NextResponse.json(result, { status });
}

type RequestBody =
  | { action: "sign-message"; payload: WalletSolanaSignMessagePayload }
  | {
      action: "sign" | "sign-and-send";
      payload: WalletSolanaSignPayload;
    };

export async function executeSolana(request: NextRequest): Promise<Response> {
  if (!isE2ESolanaExecutorEnabled()) {
    return new NextResponse("E2E Solana execution is disabled", {
      status: 404,
    });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "Cross-origin request denied" },
      { status: 403 },
    );
  }
  const seed = verifyE2EWalletCookie(
    request.cookies.get(E2E_WALLET_COOKIE)?.value,
  );
  if (!seed?.svmAddress) {
    return NextResponse.json(
      { ok: false, error: "Missing Solana wallet seed" },
      { status: 401 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
    if (!body?.action || !body.payload) throw new Error("invalid");
  } catch {
    return NextResponse.json(
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
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
