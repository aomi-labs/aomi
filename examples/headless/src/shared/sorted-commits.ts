import type { CommitView } from "@aomi-labs/client";

/** Keep batches in first-seen order and their predecessors before successors. */
export function sortedCommits(commits: readonly CommitView[]): CommitView[] {
  const batches = new Map<string, CommitView[]>();
  const groups: CommitView[][] = [];
  for (const commit of commits) {
    if (!commit.batch) {
      groups.push([commit]);
      continue;
    }
    let group = batches.get(commit.batch.batch_id);
    if (!group) {
      group = [];
      batches.set(commit.batch.batch_id, group);
      groups.push(group);
    }
    group.push(commit);
  }
  return groups.flatMap((group) =>
    group.sort(
      (left, right) => (left.batch?.index ?? 0) - (right.batch?.index ?? 0),
    ),
  );
}
