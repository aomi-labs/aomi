import "@tanstack/react-start/server-only";
import homeHtml from "../../public/assets/landing/home/index.html?raw";

// Build the server's content into the deployment rather than relying on its CWD.
const agentFiles = import.meta.glob<string>(
  "../../content/agents/**/*.{md,txt}",
  { eager: true, query: "?raw", import: "default" },
);
const registryFiles = import.meta.glob<string>("../../public/r/**/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

export { homeHtml };

export function readAgentFile(relativePath: string): string {
  const content = agentFiles[`../../content/agents/${relativePath}`];
  if (content === undefined) throw new Error("Missing bundled agent content");
  return content;
}

export function readRegistryFile(segments: string[]): string | undefined {
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => ["", ".", ".."].includes(segment) || /[/\\]/.test(segment),
    )
  )
    return undefined;
  return registryFiles[`../../public/r/${segments.join("/")}`];
}
