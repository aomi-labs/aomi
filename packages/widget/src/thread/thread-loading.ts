export function shouldShowThreadLoadingSkeleton({
  isLoading,
  messageCount,
}: {
  isLoading: boolean;
  messageCount: number;
}): boolean {
  return isLoading && messageCount === 0;
}
