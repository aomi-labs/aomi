import "@tanstack/react-start/server-only";
import { homeHtml } from "./assets";

export async function GET() {
  return new Response(homeHtml, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
