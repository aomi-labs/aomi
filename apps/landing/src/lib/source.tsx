import { createClientLoader } from "fumadocs-mdx/runtime/browser";
import type { CompiledMDXProperties } from "fumadocs-mdx";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { getMDXComponents } from "@/features/docs/mdx-components";
type Doc = CompiledMDXProperties<{
  title: string;
  description?: string;
  full?: boolean;
}>;
function docsLoader(
  name: "examples" | "playground",
  files: Record<string, () => Promise<Doc>>,
) {
  const prefix = `../../content/${name}/`;
  return createClientLoader(
    Object.fromEntries(
      Object.entries(files).map(([file, load]) => [
        file.slice(prefix.length),
        load,
      ]),
    ),
    {
      id: name,
      component: function DocsContent({ default: MDX, toc, frontmatter }) {
        return (
          <DocsPage
            toc={toc}
            full={name === "playground" || frontmatter.full === true}
          >
            <DocsBody className={name === "playground" ? "w-full" : undefined}>
              <MDX components={getMDXComponents({})} />
            </DocsBody>
          </DocsPage>
        );
      },
    },
  );
}
export const examples = docsLoader(
  "examples",
  import.meta.glob<Doc>("../../content/examples/**/*.{mdx,md}", {
    query: { collection: "examples" },
  }),
);
export const playground = docsLoader(
  "playground",
  import.meta.glob<Doc>("../../content/playground/**/*.{mdx,md}", {
    query: { collection: "playground" },
  }),
);
