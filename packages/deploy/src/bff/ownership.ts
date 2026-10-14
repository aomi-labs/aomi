/** Ownership never depends on a caller's platform filter. */
export async function ownedProject<T extends { id: number }>(
  list: (input: { githubUserId: string }) => Promise<T[]>,
  githubUserId: string,
  projectId: number,
): Promise<T | null> {
  return (
    (await list({ githubUserId })).find(
      (project) => project.id === projectId,
    ) ?? null
  );
}
