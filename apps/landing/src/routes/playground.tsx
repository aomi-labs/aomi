import {useFumadocsLoader} from "fumadocs-core/source/client";
import {createFileRoute, Outlet} from "@tanstack/react-router";
import Layout from "@/screens/playground/layout";
import {docsTree} from "@/server-functions";
export const Route = createFileRoute("/playground")({loader: () => docsTree({data: "playground"}), component: function DocsLayoutRoute() {const {pageTree} = useFumadocsLoader<{pageTree: object}>({pageTree: Route.useLoaderData()}); return <Layout tree={pageTree}><Outlet/></Layout>;}});
