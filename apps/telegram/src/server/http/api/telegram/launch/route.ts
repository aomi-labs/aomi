import { verifyTelegramInitData } from "@aomi-labs/account/telegram";

const STATUS_BY_REASON = {
  malformed: 400,
  missing_signature: 400,
  missing_user: 400,
  bad_signature: 401,
  expired: 401,
} as const;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    botId?: unknown;
    initData?: unknown;
  } | null;
  const botId = typeof body?.botId === "string" ? body.botId.trim() : "";
  const initData =
    typeof body?.initData === "string" ? body.initData.trim() : "";
  const result = verifyTelegramInitData(initData, botId);

  if (!result.ok) {
    return Response.json(
      { error: result.reason },
      {
        status: STATUS_BY_REASON[result.reason],
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return Response.json(result.launch, {
    headers: { "Cache-Control": "no-store" },
  });
}
