import { claimJti } from "../../src/api/rc-replay";
import type { ReplayStore } from "../../src/env";
export { RcReplayStore } from "../../src/api/rc-replay";

export default {
  async fetch(request: Request, env: { RC_OIDC_REPLAY: ReplayStore }) {
    const { jti, expiresAt } = await request.json() as { jti: string; expiresAt: number };
    return new Response(null, { status: await claimJti(env.RC_OIDC_REPLAY, jti, expiresAt) ? 204 : 409 });
  },
};
