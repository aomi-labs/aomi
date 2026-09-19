import { createWidgetSiweChallenge } from "@aomi-labs/account/widget-auth";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  widgetChallengeResponse,
  widgetPreflight,
  widgetRoute,
} from "@portal/server/widget-auth/response";
import { z } from "zod";

const requestSchema = z.object({
  wallet_address: z.string().min(1),
  chain_id: z.number().int().positive(),
});

export const POST = widgetRoute(async (request: Request) => {
  const limited = widgetAuthRateLimit(request);
  if (limited) return limited;
  const parsed = requestSchema.parse(await request.json().catch(() => null));
  const challenge = await createWidgetSiweChallenge({
    request,
    walletAddress: parsed.wallet_address,
    chainId: parsed.chain_id,
  });
  return widgetChallengeResponse(challenge);
}, "widget.siwe.nonce");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
