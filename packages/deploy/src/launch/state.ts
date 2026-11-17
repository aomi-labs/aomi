export function normalizeRepo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return null;
    const [owner, repo] = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    candidate = owner && repo ? `${owner}/${repo}` : "";
  } catch {
    candidate = trimmed.replace(/^github\.com\//i, "");
  }

  const m = candidate.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function platformParam(
  value: string | string[] | undefined,
): string | undefined {
  const platform = typeof value === "string" ? value.trim() : "";
  return platform || undefined;
}
