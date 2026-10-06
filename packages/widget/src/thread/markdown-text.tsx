"use client";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import {
  type ComponentPropsWithoutRef,
  type FC,
  memo,
  useMemo,
  useState,
} from "react";
import { useMessage } from "@assistant-ui/react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "./tooltip-icon-button";
import { OnchainLink } from "./onchain-link";
import {
  remarkExplorerLinks,
  toolExplorerLinks,
} from "./explorer-links";
import { cn } from "@aomi-labs/react";

// Each renderer owns its selector cache. Text/tool updates with unchanged
// explorer meaning must not recreate the Markdown parser's plugin inputs.
const createExplorerLinkSelector = () => {
  let previous = new Map<string, string | null>();
  return ({ content }: { content: readonly unknown[] }) => {
    const next = toolExplorerLinks(content);
    if (
      next.size !== previous.size ||
      [...next].some(([identifier, url]) => previous.get(identifier) !== url)
    )
      previous = next;
    return previous;
  };
};
const EMPTY_EXPLORER_LINKS = new Map<string, string | null>();

const MarkdownTextImpl = () => {
  // Detached trace parts can still inherit their message's explorer context.
  const selector = useMemo(createExplorerLinkSelector, []);
  const links =
    useMessage({ optional: true, selector }) ?? EMPTY_EXPLORER_LINKS;
  const remarkPlugins = useMemo<
    ComponentPropsWithoutRef<typeof MarkdownTextPrimitive>["remarkPlugins"]
  >(() => [remarkGfm, [remarkExplorerLinks, links]], [links]);
  return <MarkdownDisplay remarkPlugins={remarkPlugins} />;
};

const MarkdownDisplay = memo(function MarkdownDisplay({
  remarkPlugins,
}: {
  remarkPlugins: ComponentPropsWithoutRef<
    typeof MarkdownTextPrimitive
  >["remarkPlugins"];
}) {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={remarkPlugins}
      className="aui-md"
      components={defaultComponents}
    />
  );
});

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root mt-2.5 flex items-center justify-between rounded-t-lg border border-border/50 border-b-0 bg-muted/50 px-3 py-1.5 text-xs">
      <span className="aui-code-header-language font-medium text-muted-foreground lowercase">
        {language}
      </span>
      <TooltipIconButton tooltip="Copy" onClick={onCopy}>
        {!isCopied && <CopyIcon />}
        {isCopied && <CheckIcon />}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({
  copiedDuration = 3000,
}: {
  copiedDuration?: number;
} = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mb-2 scroll-m-20 font-semibold text-base first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h1">)}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-3 mb-1.5 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h2">)}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-2.5 mb-1 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h3">)}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-2 mb-1 scroll-m-20 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h4">)}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h5">)}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h6">)}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-2.5 leading-normal first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"p">)}
    />
  ),
  a: ({ className, ...props }) => (
    <OnchainLink
      className={className}
      {...(props as ComponentPropsWithoutRef<"a">)}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote my-2.5 border-muted-foreground/30 border-l-2 pl-3 text-muted-foreground italic",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"blockquote">)}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul my-2 ml-4 list-disc marker:text-muted-foreground [&>li]:mt-1",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"ul">)}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol my-2 ml-4 list-decimal marker:text-muted-foreground [&>li]:mt-1",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"ol">)}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr my-2 border-muted-foreground/20", className)}
      {...(props as ComponentPropsWithoutRef<"hr">)}
    />
  ),
  table: ({ className, ...props }) => (
    <table
      className={cn(
        "aui-md-table my-2 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"table">)}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-2 py-1 text-left font-medium first:rounded-tl-lg last:rounded-tr-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"th">)}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-b border-l px-2 py-1 text-left last:border-r [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"td">)}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"tr">)}
    />
  ),
  li: ({ className, ...props }) => (
    <li
      className={cn("aui-md-li leading-normal", className)}
      {...(props as ComponentPropsWithoutRef<"li">)}
    />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...(props as ComponentPropsWithoutRef<"sup">)}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "aui-md-pre overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-3 text-xs leading-relaxed",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"pre">)}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]",
          className,
        )}
        {...(props as ComponentPropsWithoutRef<"code">)}
      />
    );
  },
  CodeHeader,
});
