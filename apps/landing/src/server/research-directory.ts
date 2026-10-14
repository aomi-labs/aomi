import "@tanstack/react-start/server-only";
import inventory from "virtual:aomi-research-files";
import type { ResearchDirectory } from "@/lib/research-directory";
export function readResearchDirectory(
  segments: string[],
): ResearchDirectory | null {
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\\/\0]/.test(segment),
    )
  )
    return null;
  const directory = segments.join("/");
  if (
    directory &&
    !inventory.some((entry) => entry.path === directory && entry.isDirectory)
  )
    return null;
  const prefix = directory ? `${directory}/` : "";
  const entries = inventory
    .filter(
      (entry) =>
        entry.path.startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes("/"),
    )
    .map((entry) => ({
      name: entry.path.slice(prefix.length),
      isDirectory: entry.isDirectory,
      size: entry.size,
      href: `${entry.isDirectory ? "/research/aomibench-v0-1/data" : "/research/aomibench-v0.1/aombench_v1_data"}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
    }))
    .sort((a, b) =>
      a.isDirectory !== b.isDirectory
        ? a.isDirectory
          ? -1
          : 1
        : a.name.localeCompare(b.name),
    );
  return { segments, entries };
}
