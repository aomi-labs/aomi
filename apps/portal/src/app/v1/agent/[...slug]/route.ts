import { routes } from "@/server/bff/routes";
export const { GET, POST, PATCH, DELETE, OPTIONS } = routes.agent;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
