import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
export const researchArticle = createServerFn({ method: "GET" })
  .inputValidator(z.string().min(1).max(128))
  .handler(async ({ data }) => {
    const { readResearchPost } = await import("@/server/research");
    const post = await readResearchPost(data);
    if (!post) throw notFound();
    return post;
  });
export const researchDirectory = createServerFn({ method: "GET" })
  .inputValidator(z.array(z.string().min(1).max(255)).max(32))
  .handler(async ({ data }) => {
    const { readResearchDirectory } =
      await import("@/server/research-directory");
    const directory = readResearchDirectory(data);
    if (!directory) throw notFound();
    return directory;
  });

const docsCollection = z.enum(["examples", "playground"]);
export const docsTree = createServerFn({method: "GET"}).inputValidator(docsCollection).handler(async ({data}) => {
 const sources = await import("@/server/docs"); return sources[data].serializePageTree(sources[data].pageTree);
});
export const docsPage = createServerFn({method: "GET"}).inputValidator(z.object({collection: docsCollection, slug: z.array(z.string().min(1).max(255)).max(32)})).handler(async ({data}) => {
 const sources = await import("@/server/docs");
 const page = sources[data.collection].getPage(data.slug);
 if (!page) throw notFound();
 return {path: page.path, title: page.data.title, description: page.data.description ?? null};
});
