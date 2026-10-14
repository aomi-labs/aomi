import { NextResponse } from "next/server";

export const runtime = "nodejs";

import { clearGitHubSessionCookie } from "@/server/cookies/github";

// POST /api/bff/auth/github/signout — drop the Aomi Build GitHub session.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearGitHubSessionCookie(res);
  return res;
}
