import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import defaultComponents from "fumadocs-ui/mdx";

const mdxComponents = defaultComponents;

export function PreambleDisplay({
  content,
  title = "System Prompt",
  description = "The system prompt used to configure the AI assistant for this integration.",
  children,
}: {
  content: string;
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-6">
      <h2 className="text-2xl font-semibold text-fd-foreground">{title}</h2>
      <p className="mt-2 text-base leading-7 text-fd-foreground/90">
        {description}
      </p>

      <div className="mt-6 rounded-2xl border border-fd-border bg-fd-card px-6 py-5">
        <div className="docs-prose prose dark:prose-invert max-w-none">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={mdxComponents as unknown as Record<string, React.ComponentType>}
          >
            {content}
          </Markdown>
        </div>
        {children}
      </div>
    </div>
  );
}
