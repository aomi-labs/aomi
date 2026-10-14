import { routes } from "@/server/bff/routes";
export const { GET, OPTIONS } = routes.pipeline;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
