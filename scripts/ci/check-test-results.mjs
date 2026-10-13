import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Unrelated, preexisting settlement behavior stays explicitly recorded. Auth,
// projection, session and browser journeys have no skip exceptions in CI.
const noncriticalSkips = [
  {
    file: "/apps/build/src/server/bff/operate/routes.test.ts",
    title: "deduplicates a recipient-bucket settlement shared by two projects",
  },
];

export function verifyTestReport(report, minimum = 1) {
  if (report.stats) {
    const { expected, unexpected, skipped, flaky } = report.stats;
    if (
      ![expected, unexpected, skipped, flaky].every(Number.isFinite) ||
      expected < minimum ||
      unexpected !== 0 ||
      skipped !== 0 ||
      flaky !== 0
    )
      throw new Error(
        "Browser report contains failures, skips, flakes or missing journeys",
      );
    return;
  }
  if (
    !Array.isArray(report.testResults) ||
    !report.testResults.length ||
    report.numFailedTests ||
    report.numFailedTestSuites
  )
    throw new Error("Unit report is missing or failed");
  let passed = 0;
  const consumed = new Set();
  for (const suite of report.testResults) {
    for (const result of suite.assertionResults ?? []) {
      if (result.status === "passed") {
        passed++;
        continue;
      }
      if (["pending", "skipped", "todo"].includes(result.status)) {
        const exception = noncriticalSkips.find(
          (entry) =>
            suite.name.replaceAll("\\", "/").endsWith(entry.file) &&
            result.title === entry.title,
        );
        if (exception && !consumed.has(exception)) {
          consumed.add(exception);
          continue;
        }
      }
      throw new Error(
        `Unexpected unit result: ${result.fullName ?? result.title} (${result.status})`,
      );
    }
  }
  if (passed < minimum) throw new Error("Unit report omitted required tests");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2];
  if (!path) throw new Error("Pass a Vitest or Playwright JSON report");
  verifyTestReport(
    JSON.parse(readFileSync(path, "utf8")),
    Number(process.argv[3] ?? 1),
  );
}
