import { permanentRedirect } from "next/navigation";

// /news moved to /blog. Kept as a route so old links keep working.
export default function NewsPage() {
  permanentRedirect("/blog");
}
