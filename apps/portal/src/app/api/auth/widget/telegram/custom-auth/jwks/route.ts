import { telegramCustomAuthJwk } from "@portal/server/widget-auth/telegram-custom-auth";

export async function GET(): Promise<Response> {
  try {
    return Response.json(
      { keys: [await telegramCustomAuthJwk()] },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "telegram_custom_auth_not_configured";
    return Response.json({ error: code }, { status: 503 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
