import { routes } from "@/server/bff/routes";
export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = routes.backend;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
