import type { CommitView } from "@aomi-labs/client";
import { describe, expect, it } from "vitest";
import { sortedCommits } from "./sorted-commits";

function commit(id: string, batchId?: string, index = 0): CommitView {
  return {
    commit_id: id,
    batch: batchId ? { batch_id: batchId, index } : null,
  } as CommitView;
}

describe("terminal commit order", () => {
  it("orders interleaved batches by first appearance and dependency index", () => {
    const input = [
      commit("a1", "a", 1),
      commit("solo"),
      commit("b1", "b", 1),
      commit("a0", "a", 0),
      commit("b0", "b", 0),
    ];
    expect(sortedCommits(input).map((view) => view.commit_id)).toEqual([
      "a0",
      "a1",
      "solo",
      "b0",
      "b1",
    ]);
    expect(input.map((view) => view.commit_id)).toEqual([
      "a1",
      "solo",
      "b1",
      "a0",
      "b0",
    ]);
  });

  it("preserves arrival order for independent commits and equal batch indices", () => {
    const input = [
      commit("first"),
      commit("a", "batch", 0),
      commit("b", "batch", 0),
      commit("last"),
    ];
    expect(sortedCommits(input)).toEqual(input);
    expect(sortedCommits([])).toEqual([]);
  });
});
