import { managedOriginAllowed } from "@/server/edge/principal-token";
export const GET = managedOriginAllowed;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
