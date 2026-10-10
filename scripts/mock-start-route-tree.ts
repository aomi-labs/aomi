// Router unit tests provide their own vi.mock factory; generated files are
// intentionally absent in a fresh checkout.
export const mockStartRouteTree = {
  name: "mock-start-route-tree",
  enforce: "pre" as const,
  resolveId(id: string) {
    if (id === "./routeTree.gen") return id;
  },
};
