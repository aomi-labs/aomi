import { verifyWidgetSiweProof } from "@aomi-labs/account/widget-auth";
import { widgetAuthRateLimit } from "@portal/server/widget-auth/rate-limit";
import {
  widgetPreflight,
  widgetRoute,
  widgetSessionResponse,
} from "@portal/server/widget-auth/response";
import { z } from "zod";

const requestSchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  wallet_address: z.string().min(1),
  chain_id: z.number().int().positive(),
});

export const POST = widgetRoute(async (request: Request) => {
  const limited = widgetAuthRateLimit(request);
  if (limited) return limited;
  const parsed = requestSchema.parse(await request.json().catch(() => null));
  const session = await verifyWidgetSiweProof({
    request,
    message: parsed.message,
    signature: parsed.signature,
    walletAddress: parsed.wallet_address,
    chainId: parsed.chain_id,
  });
  return widgetSessionResponse(session);
}, "widget.siwe.verify");

export const OPTIONS = widgetPreflight(["POST", "OPTIONS"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
