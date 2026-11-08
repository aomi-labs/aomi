/** Read saved Solana reviews as well as new ones, whose assembly keeps the
 * staged action titles. These describe the request, not simulated effects. */
export function svmTransactionLabel(transaction: {
  description?: string;
  instructions: readonly { program_id: string; description: string }[];
}): string {
  const description = transaction.description?.trim();
  if (description && !/^svm bundle of \d+ instructions$/i.test(description))
    return description;
  const actions = transaction.instructions
    .filter(
      (ix) => ix.program_id !== "ComputeBudget111111111111111111111111111111",
    )
    .map((ix) => ix.description.trim())
    .filter(Boolean);
  return [...new Set(actions)].join(" · ") || "Solana transaction";
}
