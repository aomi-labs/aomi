import "@tanstack/react-start/server-only";
import { getResearchPost } from "@/lib/research";
const markdown = import.meta.glob<string>("../../content/research/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const figures = import.meta.glob(
  "../../public/research/aomibench-v0.1/figures/**/*",
  { query: "?url", import: "default", eager: true },
);
function renderPendingFigureComments(body: string) {
  return body.replace(
    /<!--\s*Figure\s+(\d+)(?:\s*\([^)]*\))?\s+—\s+([\s\S]*?)\.\s+Not yet built\.\s*-->/g,
    (_match, number: string, title: string) => {
      const cleanTitle = title.replace(/\s*\(←[^)]*\)/g, "").trim();

      return `\n\n> **Figure ${number} — ${cleanTitle}**\n> Chart pending.\n\n`;
    },
  );
}

function renderMissingFigureImages(body: string) {
  return body.replace(
    /!\[([^\]]+)\]\(figures\/([^)]+)\)/g,
    (match, alt: string, fileName: string) => {
      const asset = `../../public/research/aomibench-v0.1/figures/${fileName}`;

      if (asset in figures) {
        return match;
      }

      const title = alt.split(".")[0]?.trim() || `Figure asset ${fileName}`;

      return `\n\n> **${title}**\n> Figure asset pending: \`${fileName}\`.\n\n`;
    },
  );
}

function prepareResearchMarkdown(body: string, slug: string) {
  const prepared =
    slug === "aomibench-v0-1"
      ? renderMissingFigureImages(renderPendingFigureComments(body))
      : body;

  return prepared
    .replace(/^<!--[\s\S]*?-->\s*/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

export async function readResearchPost(slug: string) {
  const post = getResearchPost(slug);

  if (post === null) {
    return null;
  }

  if (post.fileName === undefined) {
    return {
      ...post,
      body: "",
    };
  }

  const body = markdown[`../../content/research/${post.fileName}`];
  if (body === undefined)
    throw new Error(`Missing bundled research article: ${post.fileName}`);

  return {
    ...post,
    body: prepareResearchMarkdown(body, slug),
  };
}
