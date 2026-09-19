import { NextRequest, NextResponse } from "next/server";
import {
  E2E_WALLET_COOKIE,
  isE2EWalletEnabled,
  mintE2EWalletCookie,
  parseE2EAddress,
  parseE2EChainId,
  parseE2ESvmAddress,
  parseE2ESvmCluster,
  parseE2ETtlSeconds,
  validateE2EWalletToken,
} from "@portal/server/e2e-wallet";

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

export function GET(request: NextRequest) {
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

  const chainId = parseE2EChainId(request.nextUrl.searchParams.get("chainId"));
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
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlSeconds,
  });
  return response;
}
