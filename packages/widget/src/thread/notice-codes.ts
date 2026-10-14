/** The backend paused the turn at its active-work limit; it did not fail. */
export const isWorkLimitPause = (noticeCode: string | undefined) =>
  noticeCode === "execution_active_timeout";
