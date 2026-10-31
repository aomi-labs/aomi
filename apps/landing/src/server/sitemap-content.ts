import "@tanstack/react-start/server-only";

// Only file names are needed; raw queries keep compiled MDX/UI out of this graph.
const files = import.meta.glob("../../content/{examples,playground}/**/*.mdx", {
  query: "?raw",
  import: "default",
});

export function contentUrls(collection: "examples" | "playground"): string[] {
  const prefix = `../../content/${collection}/`;
  return Object.keys(files)
    .filter((file) => file.startsWith(prefix))
    .map((file) => {
      const segments = file.slice(prefix.length, -".mdx".length).split("/");
      if (segments.at(-1) === "index") segments.pop();
      const slug = segments
        .filter((segment) => !/^\(.+\)$/.test(segment))
        .map((segment) => encodeURI(segment))
        .join("/");
      return `/${collection}/${slug}`;
    });
}
