import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";
import type { Root } from "fumadocs-core/page-tree";
import { Provider } from "../provider";
import "../docs-ui.css";
import {
  baseLayoutOptions,
  navTabs,
  sharedSidebarOptions,
} from "../layout-config";

export default function Layout({
  children,
  tree,
}: {
  children: ReactNode;
  tree: Root;
}) {
  return (
    <Provider>
      <DocsLayout
        {...baseLayoutOptions}
        nav={{ ...baseLayoutOptions.nav, mode: "top" }}
        tree={tree}
        tabMode="navbar"
        sidebar={{ ...sharedSidebarOptions, tabs: navTabs }}
      >
        {children}
      </DocsLayout>
    </Provider>
  );
}
