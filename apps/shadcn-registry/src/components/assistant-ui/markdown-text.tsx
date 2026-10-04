"use client";

import "@assistant-ui/react-markdown/styles/dot.css";

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { useMessage } from "@assistant-ui/react";
import { toolIdentifierReferences } from "./explorer-links";
import { remarkOnchainIdentifiers } from "./remark-onchain-identifiers";
import {
  type ComponentPropsWithoutRef,
  type FC,
  memo,
  useMemo,
  useState,
} from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { OnchainLink } from "@/components/assistant-ui/onchain-link";
import { cn } from "@aomi-labs/react";

const MarkdownTextImpl = () => {
  const content = useMessage({ optional: true })?.content;
  const plugins = useMemo<
    ComponentPropsWithoutRef<typeof MarkdownTextPrimitive>["remarkPlugins"]
  >(
    () => [
      remarkGfm,
      [remarkOnchainIdentifiers, toolIdentifierReferences(content ?? [])],
    ],
    [content],
  );
  return (
    <MarkdownTextPrimitive
      remarkPlugins={plugins}
      className="aui-md"
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className="aui-code-header-root border-border/50 bg-muted/50 mt-2.5 flex items-center justify-between rounded-t-lg border border-b-0 px-3 py-1.5 text-xs">
      <span className="aui-code-header-language text-muted-foreground font-medium lowercase">
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
        "aui-md-h1 mb-2 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h1">)}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mb-1.5 mt-3 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h2">)}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mb-1 mt-2.5 scroll-m-20 text-sm font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h3">)}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mb-1 mt-2 scroll-m-20 text-sm font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h4">)}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mb-1 mt-2 text-sm font-medium first:mt-0 last:mb-0",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"h5">)}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mb-1 mt-2 text-sm font-medium first:mt-0 last:mb-0",
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
        "aui-md-blockquote border-muted-foreground/30 text-muted-foreground my-2.5 border-l-2 pl-3 italic",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"blockquote">)}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul marker:text-muted-foreground my-2 ml-4 list-disc [&>li]:mt-1",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"ul">)}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol marker:text-muted-foreground my-2 ml-4 list-decimal [&>li]:mt-1",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"ol">)}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr border-muted-foreground/20 my-2", className)}
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
        "aui-md-th bg-muted [[align=center]]:text-center [[align=right]]:text-right px-2 py-1 text-left font-medium first:rounded-tl-lg last:rounded-tr-lg",
        className,
      )}
      {...(props as ComponentPropsWithoutRef<"th">)}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 [[align=center]]:text-center [[align=right]]:text-right border-b border-l px-2 py-1 text-left last:border-r",
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
        "aui-md-pre border-border/50 bg-muted/30 overflow-x-auto rounded-b-lg rounded-t-none border border-t-0 p-3 text-xs leading-relaxed",
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
            "aui-md-inline-code border-border/50 bg-muted/50 rounded-md border px-1.5 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]",
          className,
        )}
        {...(props as ComponentPropsWithoutRef<"code">)}
      />
    );
  },
  CodeHeader,
});
