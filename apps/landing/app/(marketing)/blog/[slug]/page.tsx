import { blogPosts } from "@/lib/research";
import ResearchPostPage, { generateMetadata } from "../../research/[slug]/page";

// Blog posts share the research post page; only the URL prefix differs.
export { generateMetadata };

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export default ResearchPostPage;
