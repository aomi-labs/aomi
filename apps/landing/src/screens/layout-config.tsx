import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { AomiLogo } from "./components/aomi-logo";

export const navLinks: NonNullable<BaseLayoutProps["links"]> = [
  {
    text: "Documentation",
    url: "https://aomi.dev/docs/",
    active: "nested-url",
  },
  {
    text: "Examples",
    url: "/examples/polymarket",
    active: "nested-url",
  },
  {
    text: "Playground",
    url: "/playground/configurator",
    active: "nested-url",
  },
];

export const navTabs = [
  { title: "Documentation", url: "https://aomi.dev/docs/" },
  { title: "Examples", url: "/examples/polymarket" },
  { title: "Playground", url: "/playground/configurator" },
];

export const baseLayoutOptions: BaseLayoutProps = {
  githubUrl: "https://github.com/aomi-labs/aomi-widget",
  nav: {
    title: <AomiLogo className="text-[14px]" markClassName="h-3.5 w-3.5" />,
    url: "https://aomi.dev",
    transparentMode: "none",
  },
  links: navLinks,
};

export const sharedSidebarOptions = {
  defaultOpenLevel: 0,
  tabs: false,
  collapsible: true,
};
