import type { MDXComponents } from "mdx/types";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultComponents from "fumadocs-ui/mdx";
import {
  CodeBlock,
  type CodeBlockProps,
  Pre,
} from "fumadocs-ui/components/codeblock";
import * as Twoslash from "fumadocs-twoslash/ui";

import { WidgetDemo } from "@/content/components/samples/widget-demo";
import { PlaygroundConfigurator } from "@/content/components/playground/playground-configurator";
import { SessionsConsole } from "@/components/examples/sessions-console";
import { SystemConsole } from "@/components/examples/system-console";

import "fumadocs-twoslash/twoslash.css";

export function getMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    ...Twoslash,
    WidgetDemo,
    PlaygroundConfigurator,
    SessionsConsole,
    SystemConsole,
    pre: (props: CodeBlockProps) => (
      <CodeBlock {...props}>
        <Pre className="max-h-[400px]">{props.children}</Pre>
      </CodeBlock>
    ),
    Tabs,
    Tab,
    Callout,
    TypeTable,
    Accordion,
    Accordions,
    blockquote: (props) => <Callout>{props.children}</Callout>,
    ...components,
  };
}

// For backwards compatibility with @next/mdx
export function useMDXComponents(
  components: MDXComponents = {},
): MDXComponents {
  return getMDXComponents(components);
}
