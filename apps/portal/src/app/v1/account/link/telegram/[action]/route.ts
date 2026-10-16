import { routes } from "@/server/bff/routes";
export const { POST } = routes.telegramLink;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Confirm waits up to ~30 s for trades in progress to finish.
export const maxDuration = 60;
