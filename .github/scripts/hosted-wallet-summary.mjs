/** Scalar-only export: never include Playwright titles, errors, attachments or config. */
export function summarize({
  sourceSha,
  runId,
  startedAt,
  finishedAt,
  total,
  attempts,
  fullStatus,
}) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha) || !/^[1-9][0-9]*$/.test(runId)) {
    throw new Error("Exact checkout SHA and GitHub run ID required");
  }
  for (const at of [startedAt, finishedAt]) {
    if (
      typeof at !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) ||
      !Number.isFinite(Date.parse(at))
    ) {
      throw new Error("UTC timestamps required");
    }
  }
  if (finishedAt < startedAt || !Number.isSafeInteger(total) || total < 0)
    throw new Error("Invalid execution bounds");
  let passed = 0,
    failures = 0,
    skipped = 0,
    retries = 0;
  for (const attempt of attempts) {
    if (
      !["passed", "failed", "timedOut", "skipped", "interrupted"].includes(
        attempt.status,
      ) ||
      !Number.isSafeInteger(attempt.retry) ||
      attempt.retry < 0
    )
      throw new Error("Invalid test outcome");
    if (attempt.status === "passed") passed++;
    else if (attempt.status === "skipped") skipped++;
    else failures++;
    if (attempt.retry > 0) retries++;
  }
  // Any retry is conservatively incomplete, including a passing retry. Failure
  // counts retain earlier attempts; no flaky run can become an unqualified PASS.
  const flaky = attempts.filter(
    (x) => x.retry > 0 && x.status === "passed",
  ).length;
  const status =
    fullStatus !== "passed" || failures
      ? "FAIL"
      : total > 0 &&
          passed === total &&
          attempts.length === total &&
          !skipped &&
          !retries
        ? "PASS"
        : "INCOMPLETE";
  return {
    version: 1,
    environment: "REAL_STAGING",
    sourceSha,
    runId,
    portalUrl: "https://chat-staging.aomi.dev",
    chainId: 84532,
    startedAt,
    finishedAt,
    tests: total,
    assertions: passed,
    failures,
    skipped,
    retries,
    flaky,
    status,
  };
}
