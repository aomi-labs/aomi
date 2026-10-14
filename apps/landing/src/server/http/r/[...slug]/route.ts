import "@tanstack/react-start/server-only";
import { readRegistryFile } from "../../../assets";

type RouteParams = {
  slug: string[];
};

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<RouteParams> },
) {
  const { slug } = await params;
  const content = readRegistryFile(slug ?? []);
  if (content === undefined) return notFound();
  return new Response(content, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
